import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { aiVisibilityAudits, aiVisibilityQueries, businessLocations, keywords } from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { invalid, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { AI_SEARCH_PROVIDER_IDS, getAiSearchProvider } from "../integrations/ai-search";
import { analyzeAnswer, buildQueries, QUERY_TEMPLATE_VERSION } from "@/lib/ai-visibility";
import { assertWithinLimit, recordUsage } from "./usage";

export function providerAvailability(targetName = "Business") {
  return AI_SEARCH_PROVIDER_IDS.map((id) => {
    const p = getAiSearchProvider(id, targetName);
    return { id, label: p.label, support: p.support, isDemo: p.isDemo, notes: p.notes };
  });
}

function domainOf(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Creates an audit with one query row per (keyword x template x provider), then queues it. */
export async function startAiVisibilityAudit(businessId: string, opts: { providers: string[]; queriesPerKeyword: number; keywordIds?: string[]; trigger: "manual" | "schedule" }, actor?: Actor) {
  if (actor) await requireBusiness(actor, businessId, "audits.run");
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const conds = [eq(keywords.businessId, businessId), eq(keywords.isTracked, true), isNull(keywords.archivedAt)];
  if (opts.keywordIds?.length) conds.push(inArray(keywords.id, opts.keywordIds));
  const kws = await db.select().from(keywords).where(and(...conds)).orderBy(asc(keywords.priority)).limit(10);
  if (!kws.length) throw invalid("Add at least one tracked keyword first");
  const providers = opts.providers.filter((p) => (AI_SEARCH_PROVIDER_IDS as readonly string[]).includes(p));
  if (!providers.length) throw invalid("Choose at least one AI assistant to check");
  const live = providers.filter((p) => getAiSearchProvider(p, b.name).support !== "unsupported" && !getAiSearchProvider(p, b.name).isDemo);
  const rows = kws.flatMap((k) => {
    const city = k.city ?? b.city ?? b.serviceArea?.places?.[0] ?? null;
    return buildQueries(k.phrase, city, opts.queriesPerKeyword).flatMap((q) => providers.map((p) => ({ keywordId: k.id, keyword: k.phrase, city, queryText: q, provider: p })));
  });
  if (live.length) await assertWithinLimit(b.orgId, "ai_visibility_query", rows.filter((r) => live.includes(r.provider)).length);
  const [audit] = await db.insert(aiVisibilityAudits).values({ businessId, providers, templateVersion: QUERY_TEMPLATE_VERSION, trigger: opts.trigger }).returning();
  await db.insert(aiVisibilityQueries).values(rows.map((r) => ({ ...r, auditId: audit.id, businessId })));
  await enqueue("aiVisibility.audit", { auditId: audit.id }, { idempotencyKey: `ai-vis:${audit.id}`, timeoutMs: 30 * 60_000, businessId, orgId: b.orgId });
  await logActivity({ orgId: b.orgId, businessId, actor: actor ? userActor(actor.userId) : systemActor, action: "ai_visibility.started", target: { type: "ai_visibility_audit", id: audit.id }, detail: { queries: rows.length, providers } });
  return audit;
}

/** Worker: asks each provider. Unsupported or unconfigured providers are recorded as such, never as "not mentioned". */
export async function executeAiVisibilityAudit(auditId: string) {
  const [audit] = await db.select().from(aiVisibilityAudits).where(eq(aiVisibilityAudits.id, auditId)).limit(1);
  if (!audit || ["completed", "partial", "failed"].includes(audit.status)) return { skipped: true };
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, audit.businessId)).limit(1);
  await db.update(aiVisibilityAudits).set({ status: "running" }).where(eq(aiVisibilityAudits.id, auditId));
  const queued = await db.select().from(aiVisibilityQueries).where(and(eq(aiVisibilityQueries.auditId, auditId), eq(aiVisibilityQueries.status, "queued")));
  const target = { name: b.name, domain: domainOf(b.website) };
  let liveCount = 0;
  for (const q of queued) {
    const provider = getAiSearchProvider(q.provider, b.name);
    if (provider.support === "unsupported") {
      await db.update(aiVisibilityQueries).set({ status: "unsupported", error: provider.notes, ranAt: new Date() }).where(eq(aiVisibilityQueries.id, q.id));
      continue;
    }
    try {
      const ans = await provider.ask(q.queryText, { city: q.city, region: b.region, country: b.country });
      const a = analyzeAnswer(ans.text, ans.sources, target);
      await db
        .update(aiVisibilityQueries)
        .set({ status: "succeeded", model: ans.model, responseText: ans.text.slice(0, 20000), sources: ans.sources.slice(0, 30), mentionedBusinesses: a.mentionedBusinesses, mentioned: a.mentioned, position: a.position, isDemo: provider.isDemo, ranAt: new Date() })
        .where(eq(aiVisibilityQueries.id, q.id));
      if (!provider.isDemo) liveCount++;
    } catch (e) {
      await db.update(aiVisibilityQueries).set({ status: "failed", error: (e as Error).message.slice(0, 500), isDemo: provider.isDemo, ranAt: new Date() }).where(eq(aiVisibilityQueries.id, q.id));
    }
  }
  if (liveCount) await recordUsage(b.orgId, b.id, "ai_visibility_query", liveCount);
  const all = await db.select().from(aiVisibilityQueries).where(eq(aiVisibilityQueries.auditId, auditId));
  const ok = all.filter((x) => x.status === "succeeded");
  const stats: Record<string, number> = {
    queries: all.length,
    succeeded: ok.length,
    failed: all.filter((x) => x.status === "failed").length,
    unsupported: all.filter((x) => x.status === "unsupported").length,
    mentioned: ok.filter((x) => x.mentioned).length,
    demo: ok.filter((x) => x.isDemo).length,
  };
  const status = ok.length === 0 ? "failed" : stats.failed || stats.unsupported ? "partial" : "completed";
  await db.update(aiVisibilityAudits).set({ status, stats, completedAt: new Date() }).where(eq(aiVisibilityAudits.id, auditId));
  return { status, stats };
}

export type ProviderSummary = { provider: string; asked: number; mentioned: number; share: number | null; averagePosition: number | null; demo: boolean; unsupported: number; failed: number };

export function summarize(rows: (typeof aiVisibilityQueries.$inferSelect)[]) {
  const by = new Map<string, ProviderSummary>();
  for (const r of rows) {
    const s = by.get(r.provider) ?? { provider: r.provider, asked: 0, mentioned: 0, share: null, averagePosition: null, demo: false, unsupported: 0, failed: 0 };
    if (r.status === "succeeded") {
      s.asked++;
      if (r.mentioned) s.mentioned++;
      s.demo ||= r.isDemo;
    } else if (r.status === "unsupported") s.unsupported++;
    else if (r.status === "failed") s.failed++;
    by.set(r.provider, s);
  }
  for (const s of by.values()) {
    s.share = s.asked ? s.mentioned / s.asked : null;
    const pos = rows.filter((r) => r.provider === s.provider && r.position != null).map((r) => r.position!);
    s.averagePosition = pos.length ? Math.round((pos.reduce((a, b) => a + b, 0) / pos.length) * 10) / 10 : null;
  }
  // Competitors most often named alongside or instead of the business.
  const comp = new Map<string, number>();
  for (const r of rows) for (const m of r.mentionedBusinesses ?? []) if (!m.isTarget) comp.set(m.name, (comp.get(m.name) ?? 0) + 1);
  return { providers: [...by.values()], topCompetitors: [...comp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, mentions]) => ({ name, mentions })) };
}

export async function listAiVisibilityAudits(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(aiVisibilityAudits).where(eq(aiVisibilityAudits.businessId, businessId)).orderBy(desc(aiVisibilityAudits.createdAt)).limit(50);
}

export async function getAiVisibilityAudit(actor: Actor, businessId: string, auditId: string) {
  await requireBusiness(actor, businessId);
  const [audit] = await db.select().from(aiVisibilityAudits).where(and(eq(aiVisibilityAudits.id, auditId), eq(aiVisibilityAudits.businessId, businessId))).limit(1);
  if (!audit) throw notFound("Audit");
  const rows = await db.select().from(aiVisibilityQueries).where(eq(aiVisibilityQueries.auditId, auditId)).orderBy(asc(aiVisibilityQueries.keyword), asc(aiVisibilityQueries.provider));
  return { audit, queries: rows, summary: summarize(rows) };
}
