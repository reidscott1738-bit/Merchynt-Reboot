import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { businessKnowledge, businessLocations, businessServices, faqs, reviews, schemaDocuments, seoAudits, seoRecommendations } from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { invalid, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { safeFetch } from "../security/safe-fetch";
import { loadBusinessContext } from "../ai/context";
import { extractFactsFromWebsite, generateBusinessDescription, generateFaqs } from "../ai/tasks";
import { analyzePage, extractPage } from "@/lib/seo-analyzer";
import { buildLocalBusinessJsonLd, validateLocalBusinessJsonLd, jsonLdScriptTag } from "@/lib/schema-org";
import { PLATFORM_LIMITS, validateContent } from "@/lib/content-validation";
import { stripHtml } from "@/lib/text";
import { createTask, registerTaskHandler } from "./tasks";
import { recordAiUsage } from "./usage";
import { publicMediaUrl } from "../storage";

/* ---------------- Website audit ---------------- */

export async function startSeoAudit(actor: Actor, businessId: string, url?: string) {
  const b = await requireBusiness(actor, businessId, "audits.run");
  const target = url?.trim() || b.website;
  if (!target) throw invalid("Add the business website first, or enter a URL to audit");
  const [audit] = await db.insert(seoAudits).values({ businessId, url: target }).returning();
  await enqueue("seo.audit", { auditId: audit.id }, { idempotencyKey: `seo-audit:${audit.id}`, businessId, orgId: actor.orgId, maxAttempts: 3 });
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "seo_audit.started", target: { type: "seo_audit", id: audit.id }, detail: { url: target } });
  return audit;
}

async function checkAux(url: URL) {
  const out: { robotsTxt: "found" | "missing" | "error"; sitemap: "found" | "missing" | "error"; robotsBlocksAll: boolean } = { robotsTxt: "missing", sitemap: "missing", robotsBlocksAll: false };
  try {
    const r = await safeFetch(new URL("/robots.txt", url).toString(), { maxBytes: 200_000, timeoutMs: 8000 });
    if (r.status === 200) {
      out.robotsTxt = "found";
      const txt = r.body.toString("utf8");
      out.robotsBlocksAll = /user-agent:\s*\*\s*[\r\n]+(?:[^\n]*\n)*?\s*disallow:\s*\/\s*$/im.test(txt);
      if (/^sitemap:/im.test(txt)) out.sitemap = "found";
    }
  } catch {
    out.robotsTxt = "error";
  }
  if (out.sitemap !== "found") {
    try {
      const s = await safeFetch(new URL("/sitemap.xml", url).toString(), { maxBytes: 2_000_000, timeoutMs: 8000 });
      out.sitemap = s.status === 200 && /<(urlset|sitemapindex)/i.test(s.body.toString("utf8")) ? "found" : "missing";
    } catch {
      out.sitemap = "error";
    }
  }
  return out;
}

/** Worker: fetches the page (SSRF-safe), analyzes it, stores recommendations and proposes facts. */
export async function executeSeoAudit(auditId: string) {
  const [audit] = await db.select().from(seoAudits).where(eq(seoAudits.id, auditId)).limit(1);
  if (!audit || audit.status === "completed") return { skipped: true };
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, audit.businessId)).limit(1);
  await db.update(seoAudits).set({ status: "running", startedAt: new Date() }).where(eq(seoAudits.id, auditId));
  let res;
  try {
    res = await safeFetch(audit.url, { maxBytes: 3_000_000, accept: "text/html,application/xhtml+xml" });
  } catch (e) {
    await db.update(seoAudits).set({ status: "failed", error: (e as Error).message, completedAt: new Date() }).where(eq(seoAudits.id, auditId));
    return { failed: true };
  }
  if (res.status >= 400 || !/html/i.test(res.contentType)) {
    await db.update(seoAudits).set({ status: "failed", httpStatus: res.status, error: res.status >= 400 ? `The page returned HTTP ${res.status}` : `Expected an HTML page but got ${res.contentType || "unknown content"}`, completedAt: new Date() }).where(eq(seoAudits.id, auditId));
    return { failed: true };
  }
  const html = res.body.toString("utf8");
  const page = extractPage(html, res.url);
  const aux = await checkAux(new URL(res.url));
  const svc = await db.select().from(businessServices).where(and(eq(businessServices.businessId, b.id), eq(businessServices.status, "active"))).limit(1);
  const ctx = await loadBusinessContext(b.id);
  let proposedDescription: string | null = null;
  const text = stripHtml(html).slice(0, 15000);
  try {
    const g = await generateBusinessDescription(ctx, text);
    await recordAiUsage(b.orgId, b.id, g.meta);
    proposedDescription = g.data.description.slice(0, PLATFORM_LIMITS.meta_description * 2);
  } catch {
    /* Meta description suggestion is optional. */
  }
  const recs = analyzePage(page, { name: b.name, primaryService: svc[0]?.name ?? b.primaryCategory, city: b.city ?? b.serviceArea?.places?.[0] ?? null, phone: b.phone, description: b.description }, { proposedDescription });
  recs.push(
    aux.robotsBlocksAll
      ? { element: "robots.txt", currentValue: "Disallow: /", recommendedValue: "Allow crawling of public pages", status: "needs_work", basis: "detected", explanation: "robots.txt blocks all crawlers, so search engines may not index the site.", confidence: 0.9 }
      : { element: "robots.txt", currentValue: aux.robotsTxt, recommendedValue: null, status: aux.robotsTxt === "found" ? "optimized" : aux.robotsTxt === "error" ? "unverifiable" : "needs_work", basis: "detected", explanation: aux.robotsTxt === "found" ? "robots.txt is present." : "No robots.txt was found; adding one with a sitemap line helps crawlers.", confidence: 0.8 },
    { element: "XML sitemap", currentValue: aux.sitemap, recommendedValue: null, status: aux.sitemap === "found" ? "optimized" : aux.sitemap === "error" ? "unverifiable" : "needs_work", basis: "detected", explanation: aux.sitemap === "found" ? "A sitemap was found." : "No sitemap was found at /sitemap.xml or in robots.txt.", confidence: 0.8 },
  );
  await db.update(seoRecommendations).set({ status: "dismissed" }).where(and(eq(seoRecommendations.businessId, b.id), inArray(seoRecommendations.status, ["needs_work", "pending", "unverifiable", "optimized"])));
  if (recs.length) await db.insert(seoRecommendations).values(recs.map((r) => ({ auditId, businessId: b.id, ...r, instructions: r.instructions ?? null })));
  await db.update(seoAudits).set({ status: "completed", httpStatus: res.status, extracted: { ...page, aux }, completedAt: new Date() }).where(eq(seoAudits.id, auditId));

  // Propose facts found on the site for the owner to confirm. They are not used until verified.
  try {
    const ex = await extractFactsFromWebsite(ctx, text, res.url);
    await recordAiUsage(b.orgId, b.id, ex.meta);
    for (const f of ex.data.facts.slice(0, 25)) {
      await db
        .insert(businessKnowledge)
        .values({ businessId: b.id, category: f.category, key: f.key.slice(0, 120), value: f.value.slice(0, 2000), source: "website", sourceRef: res.url, verificationStatus: "unverified", requiresConfirmation: true, evidence: f.evidence.slice(0, 500) })
        .onConflictDoNothing();
    }
  } catch (e) {
    await logActivity({ orgId: b.orgId, businessId: b.id, actor: systemActor, action: "seo_audit.fact_extraction_failed", detail: { error: (e as Error).message } });
  }
  return { recommendations: recs.length };
}

export async function latestSeoAudit(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  const [audit] = await db.select().from(seoAudits).where(eq(seoAudits.businessId, businessId)).orderBy(desc(seoAudits.createdAt)).limit(1);
  if (!audit) return null;
  const recs = await db.select().from(seoRecommendations).where(eq(seoRecommendations.auditId, audit.id));
  return { audit, recommendations: recs };
}

export async function markSeoRecommendation(actor: Actor, businessId: string, recId: string, status: "applied" | "dismissed") {
  await requireBusiness(actor, businessId, "website.edit");
  const [r] = await db.update(seoRecommendations).set({ status, appliedAt: status === "applied" ? new Date() : null }).where(and(eq(seoRecommendations.id, recId), eq(seoRecommendations.businessId, businessId))).returning();
  if (!r) throw notFound("Recommendation");
  return r;
}

/* ---------------- Structured data ---------------- */

export async function buildSchemaForBusiness(businessId: string, siteUrl?: string | null) {
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const svcs = await db.select().from(businessServices).where(and(eq(businessServices.businessId, businessId), eq(businessServices.status, "active")));
  const [agg] = await db.select({ n: sql<number>`count(*)::int`, avg: sql<number | null>`avg(${reviews.rating})::float` }).from(reviews).where(and(eq(reviews.businessId, businessId), eq(reviews.isDemo, false)));
  const doc = buildLocalBusinessJsonLd({
    name: b.name,
    description: b.description,
    url: siteUrl ?? b.website,
    phone: b.phone,
    email: b.email,
    logoUrl: b.logoAssetId ? publicMediaUrl(b.logoAssetId, "web", true) : null,
    primaryCategory: b.primaryCategory,
    address: { line1: b.addressLine1, city: b.city, region: b.region, postalCode: b.postalCode, country: b.country },
    hideAddress: b.hideAddress,
    geo: !b.hideAddress && b.latitude != null && b.longitude != null ? { lat: b.latitude, lng: b.longitude } : null,
    hours: b.hours,
    serviceAreas: b.serviceArea?.places ?? [],
    services: svcs.map((s) => ({ name: s.name, description: s.description })),
    // Self-serving review markup is ineligible for Google rich results, so ratings are only included when real reviews exist and are flagged as such.
    aggregateRating: agg.n >= 5 && agg.avg ? { ratingValue: Math.round(agg.avg * 10) / 10, reviewCount: agg.n } : null,
  });
  const validation = validateLocalBusinessJsonLd(doc, { name: b.name, phone: b.phone, hideAddress: b.hideAddress });
  return { doc, validation };
}

export async function generateSchemaDocument(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId, "website.edit");
  const { doc, validation } = await buildSchemaForBusiness(businessId);
  await db.update(schemaDocuments).set({ isCurrent: false }).where(eq(schemaDocuments.businessId, businessId));
  const [row] = await db.insert(schemaDocuments).values({ businessId, jsonLd: doc, validation, isCurrent: true }).returning();
  return { ...row, scriptTag: jsonLdScriptTag(doc) };
}

export async function currentSchemaDocument(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  const [row] = await db.select().from(schemaDocuments).where(and(eq(schemaDocuments.businessId, businessId), eq(schemaDocuments.isCurrent, true))).limit(1);
  return row ? { ...row, scriptTag: jsonLdScriptTag(row.jsonLd) } : null;
}

/* ---------------- FAQs ---------------- */

const qhash = (q: string) => createHash("sha256").update(q.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ")).digest("hex");

export async function generateFaqsForBusiness(businessId: string, count: number, approvalMode: "none" | "all", recipients: string[] = []) {
  const ctx = await loadBusinessContext(businessId, ["faqs"]);
  const existing = await db.select({ q: faqs.question }).from(faqs).where(eq(faqs.businessId, businessId));
  const { data, meta } = await generateFaqs(ctx, existing.map((e) => e.q), count);
  await recordAiUsage(ctx.business.orgId, businessId, meta);
  const factIds = new Set(ctx.facts.map((f) => f.id));
  const created = [];
  for (const f of data.faqs.slice(0, count)) {
    const validation = validateContent(`${f.question}\n${f.answer}`, { kind: "faq", maxLength: PLATFORM_LIMITS.faq_answer, facts: ctx.factContext });
    const needsApproval = approvalMode === "all" || !validation.ok;
    const [row] = await db
      .insert(faqs)
      .values({ businessId, question: f.question.trim(), answer: f.answer.trim(), status: needsApproval ? "pending_approval" : "approved", sourceFactIds: f.factIds.filter((id) => factIds.has(id)), validation, questionHash: qhash(f.question) })
      .onConflictDoNothing()
      .returning();
    if (!row) continue;
    if (needsApproval) {
      const task = await createTask({ orgId: ctx.business.orgId, businessId, type: "faq", title: `Approve FAQ: ${row.question.slice(0, 80)}`, summary: validation.ok ? undefined : validation.issues[0]?.message, refType: "faq", refId: row.id, notificationRecipients: recipients });
      await db.update(faqs).set({ taskId: task.id }).where(eq(faqs.id, row.id));
    }
    created.push(row);
  }
  return { created: created.length, demo: meta.isDemo };
}

export async function listFaqs(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(faqs).where(eq(faqs.businessId, businessId)).orderBy(desc(faqs.createdAt));
}

export async function saveFaq(actor: Actor, businessId: string, input: { id?: string; question: string; answer: string; status?: "approved" | "draft" }) {
  await requireBusiness(actor, businessId, "website.edit");
  const ctx = await loadBusinessContext(businessId);
  const validation = validateContent(`${input.question}\n${input.answer}`, { kind: "faq", maxLength: PLATFORM_LIMITS.faq_answer, facts: ctx.factContext });
  if (input.status === "approved" && !validation.ok) throw invalid(validation.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "));
  const values = { question: input.question.trim(), answer: input.answer.trim(), validation, questionHash: qhash(input.question), status: input.status ?? "approved", staleSince: null, updatedAt: new Date() };
  if (input.id) {
    const [r] = await db.update(faqs).set(values).where(and(eq(faqs.id, input.id), eq(faqs.businessId, businessId))).returning();
    if (!r) throw notFound("FAQ");
    return r;
  }
  const [r] = await db.insert(faqs).values({ businessId, ...values }).onConflictDoNothing().returning();
  if (!r) throw invalid("That question already exists");
  return r;
}

export async function deleteFaq(actor: Actor, businessId: string, id: string) {
  await requireBusiness(actor, businessId, "website.edit");
  await db.delete(faqs).where(and(eq(faqs.id, id), eq(faqs.businessId, businessId)));
}

registerTaskHandler("faq", {
  editable: false,
  async preview(task) {
    const [f] = await db.select().from(faqs).where(eq(faqs.id, task.refId)).limit(1);
    return { title: task.title, body: f ? `Q: ${f.question}\n\nA: ${f.answer}` : "(This FAQ was deleted.)", meta: f?.validation?.issues.length ? { Checks: f.validation.issues.map((i) => i.message).join("; ") } : undefined };
  },
  async onApprove(task) {
    const [f] = await db.select().from(faqs).where(eq(faqs.id, task.refId)).limit(1);
    if (!f) return { skipped: "deleted" };
    if (f.validation && !f.validation.ok) throw invalid(`Edit the FAQ first: ${f.validation.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ")}`);
    await db.update(faqs).set({ status: "approved", updatedAt: new Date() }).where(eq(faqs.id, f.id));
    return { approved: true };
  },
  async onReject(task) {
    await db.update(faqs).set({ status: "rejected", updatedAt: new Date() }).where(eq(faqs.id, task.refId));
  },
  async onSkip(task) {
    await db.update(faqs).set({ status: "draft", updatedAt: new Date() }).where(eq(faqs.id, task.refId));
  },
});
