import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  businessAttributes,
  businessKnowledge,
  businessLocations,
  businessServices,
  contentItems,
  mediaAssets,
  optimizationScores,
  profileRecommendations,
  reviews,
  seoAudits,
} from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, userActor } from "../activity";
import { invalid, notFound } from "../errors";
import { loadBusinessContext } from "../ai/context";
import { generateBusinessDescription, generateServiceDescriptions } from "../ai/tasks";
import { computeOptimizationScore, type ScoreInput } from "@/lib/optimization-score";
import { PLATFORM_LIMITS, validateContent } from "@/lib/content-validation";
import { normalizePhone } from "@/lib/text";
import { updateBusiness } from "./business";
import { recordAiUsage } from "./usage";

export type Recommendation = typeof profileRecommendations.$inferSelect;

const DAY = 86400_000;

export async function scoreInputs(businessId: string): Promise<ScoreInput> {
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const since180 = new Date(Date.now() - 180 * DAY);
  const since90 = new Date(Date.now() - 90 * DAY);
  const since30 = new Date(Date.now() - 30 * DAY);
  const svcs = await db.select().from(businessServices).where(and(eq(businessServices.businessId, businessId), eq(businessServices.status, "active")));
  const [attrs] = await db
    .select({ confirmed: sql<number>`count(*) filter (where ${businessAttributes.status} in ('confirmed','current'))::int`, pending: sql<number>`count(*) filter (where ${businessAttributes.status} = 'suggested')::int` })
    .from(businessAttributes)
    .where(eq(businessAttributes.businessId, businessId));
  const [rv] = await db
    .select({ total: count(), replied: sql<number>`count(*) filter (where ${reviews.ownerReply} is not null or ${reviews.replyStatus} = 'published')::int` })
    .from(reviews)
    .where(and(eq(reviews.businessId, businessId), gte(reviews.publishedAt, since180), eq(reviews.isDemo, false)));
  const [img] = await db
    .select({ recent: sql<number>`count(*) filter (where ${mediaAssets.createdAt} >= ${since90})::int`, total: count() })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.businessId, businessId), eq(mediaAssets.kind, "image"), eq(mediaAssets.moderationStatus, "approved"), isNull(mediaAssets.deletedAt), eq(mediaAssets.isAiGenerated, false)));
  const [posts] = await db.select({ n: count() }).from(contentItems).where(and(eq(contentItems.businessId, businessId), eq(contentItems.type, "gbp_post"), eq(contentItems.status, "published"), gte(contentItems.publishedAt, since30)));
  const [unverified] = await db
    .select({ n: count() })
    .from(businessKnowledge)
    .where(and(eq(businessKnowledge.businessId, businessId), eq(businessKnowledge.verificationStatus, "unverified"), inArray(businessKnowledge.category, ["contact", "pricing", "credential", "policy"])));
  const [lastSeo] = await db.select().from(seoAudits).where(and(eq(seoAudits.businessId, businessId), eq(seoAudits.status, "completed"))).orderBy(desc(seoAudits.completedAt)).limit(1);
  let websiteMatches: boolean | null = null;
  if (lastSeo?.extracted) {
    const ex = lastSeo.extracted as { phonesFound?: string[]; title?: string | null };
    const phoneOk = !b.phone || (ex.phonesFound ?? []).some((p) => normalizePhone(p) === normalizePhone(b.phone!));
    websiteMatches = phoneOk;
  }
  return {
    name: b.name,
    primaryCategory: b.primaryCategory,
    secondaryCategories: b.secondaryCategories,
    description: b.description,
    phone: b.phone,
    website: b.website,
    hasAddressOrServiceArea: Boolean(b.addressLine1 || b.city || b.serviceArea?.places?.length),
    hasHours: Boolean(b.hours && Object.keys(b.hours).length),
    activeServices: svcs.length,
    servicesWithDescriptions: svcs.filter((s) => (s.description ?? "").trim().length >= 40).length,
    confirmedAttributes: attrs?.confirmed ?? 0,
    suggestedAttributesPending: attrs?.pending ?? 0,
    reviewsLast180: rv?.total ?? 0,
    repliedLast180: rv?.replied ?? 0,
    imagesLast90: img?.recent ?? 0,
    totalApprovedImages: img?.total ?? 0,
    postsLast30: posts?.n ?? 0,
    websiteMatchesProfile: websiteMatches,
    unverifiedCriticalFacts: unverified?.n ?? 0,
  };
}

export async function refreshScore(businessId: string) {
  const { score, breakdown } = computeOptimizationScore(await scoreInputs(businessId));
  const [row] = await db.insert(optimizationScores).values({ businessId, score, breakdown }).returning();
  return row;
}

export async function scoreHistory(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(optimizationScores).where(eq(optimizationScores.businessId, businessId)).orderBy(desc(optimizationScores.computedAt)).limit(24);
}

type RecDraft = Omit<typeof profileRecommendations.$inferInsert, "businessId">;

async function upsertRec(businessId: string, r: RecDraft) {
  // One open recommendation per field: newer analysis supersedes the old one.
  await db.update(profileRecommendations).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(profileRecommendations.businessId, businessId), eq(profileRecommendations.field, r.field), eq(profileRecommendations.status, "open")));
  const [row] = await db.insert(profileRecommendations).values({ ...r, businessId }).returning();
  return row;
}

/**
 * Builds recommendations from measured gaps. Only description and service
 * descriptions are generated content; everything else is a checklist item
 * that a person must act on because it depends on facts we cannot invent.
 */
export async function generateRecommendations(businessId: string, opts: { generateCopy?: boolean } = {}) {
  const inp = await scoreInputs(businessId);
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const ctx = await loadBusinessContext(businessId, ["service_descriptions"]);
  const out: Recommendation[] = [];

  const descLen = b.description?.trim().length ?? 0;
  if (descLen < 400) {
    let proposed: string | null = null;
    let generation: Record<string, unknown> | null = null;
    if (opts.generateCopy !== false) {
      const g = await generateBusinessDescription(ctx, null);
      await recordAiUsage(b.orgId, businessId, g.meta);
      const v = validateContent(g.data.description, { kind: "description", maxLength: PLATFORM_LIMITS.gbp_description, facts: ctx.factContext });
      proposed = v.ok ? g.data.description : null;
      generation = { ...g.meta, validation: v };
    }
    out.push(
      await upsertRec(businessId, {
        field: "description",
        issue: descLen ? "Description is short" : "No business description",
        currentValue: b.description,
        proposedValue: proposed,
        reason: "Google allows 750 characters. A fuller description written from your verified facts helps customers understand what you do and where.",
        impact: "high",
        confidence: proposed ? 0.8 : 0.5,
        autoApplicable: Boolean(proposed),
        nextAction: proposed ? "Review the proposed description and apply it" : "Add verified facts (services, areas, specialties) so a description can be written",
        generation,
      }),
    );
  }

  const svcs = await db.select().from(businessServices).where(and(eq(businessServices.businessId, businessId), eq(businessServices.status, "active")));
  const missing = svcs.filter((s) => (s.description ?? "").trim().length < 40);
  if (missing.length) {
    let proposed: { serviceId: string; name: string; description: string }[] | null = null;
    if (opts.generateCopy !== false) {
      const g = await generateServiceDescriptions(ctx, missing.slice(0, 10).map((s) => s.name));
      await recordAiUsage(b.orgId, businessId, g.meta);
      proposed = g.data.services
        .map((d) => ({ d, s: missing.find((m) => m.name.toLowerCase() === d.name.toLowerCase()) }))
        .filter((x) => x.s && validateContent(x.d.description, { kind: "description", maxLength: 300, facts: ctx.factContext }).ok)
        .map((x) => ({ serviceId: x.s!.id, name: x.s!.name, description: x.d.description }));
    }
    out.push(
      await upsertRec(businessId, {
        field: "service_descriptions",
        issue: `${missing.length} service${missing.length > 1 ? "s" : ""} without a description`,
        currentValue: missing.map((m) => m.name),
        proposedValue: proposed,
        reason: "Service descriptions tell customers exactly what each service includes.",
        impact: "medium",
        confidence: 0.75,
        autoApplicable: Boolean(proposed?.length),
        nextAction: "Review the proposed descriptions",
      }),
    );
  }
  if (!svcs.length) out.push(await upsertRec(businessId, { field: "services", issue: "No services listed", reason: "Listing each service you offer helps you appear for those searches.", impact: "high", confidence: 0.9, requiresFactConfirmation: true, nextAction: "Add your services or accept suggested services in Business Profile" }));
  if (!b.secondaryCategories.length && b.primaryCategory) out.push(await upsertRec(businessId, { field: "secondary_categories", issue: "No secondary categories", reason: "Secondary categories describe other services you genuinely provide. Only add categories that are true for the business.", impact: "medium", confidence: 0.6, requiresFactConfirmation: true, nextAction: "Choose relevant secondary categories in Google Business Profile" }));
  if (!b.primaryCategory) out.push(await upsertRec(businessId, { field: "primary_category", issue: "No primary category", reason: "The primary category is one of the strongest signals for which searches you appear in.", impact: "high", confidence: 0.9, requiresFactConfirmation: true, nextAction: "Set your primary category" }));
  if (!inp.hasHours) out.push(await upsertRec(businessId, { field: "hours", issue: "No business hours", reason: "Hours are required for customers to know when to contact you.", impact: "high", confidence: 0.9, requiresFactConfirmation: true, nextAction: "Add your regular hours" }));
  if (!b.phone) out.push(await upsertRec(businessId, { field: "phone", issue: "No phone number", reason: "Calls are often the main lead action from a profile.", impact: "high", confidence: 0.9, requiresFactConfirmation: true, nextAction: "Add your business phone" }));
  if (!b.website) out.push(await upsertRec(businessId, { field: "website", issue: "No website", reason: "A website link lets customers learn more; you can generate one in Website Builder.", impact: "medium", confidence: 0.8, nextAction: "Add a website or build one in Website Builder" }));
  if (inp.suggestedAttributesPending) out.push(await upsertRec(businessId, { field: "attributes", issue: `${inp.suggestedAttributesPending} attributes to review`, reason: "Attributes such as accessibility or payment options appear on your profile. Only confirm ones that are true.", impact: "low", confidence: 0.7, requiresFactConfirmation: true, nextAction: "Confirm or reject suggested attributes" }));
  if (inp.imagesLast90 < 3) out.push(await upsertRec(businessId, { field: "photos", issue: inp.imagesLast90 ? "Few recent photos" : "No photos added in 90 days", reason: "Recent photos of real work show customers what to expect.", impact: "medium", confidence: 0.7, nextAction: "Upload photos, connect CompanyCam or share an upload link" }));
  if (inp.postsLast30 < 2) out.push(await upsertRec(businessId, { field: "posts", issue: "Few recent posts", reason: "Regular posts keep the profile current.", impact: "low", confidence: 0.6, nextAction: "Turn on the posting automation" }));
  if (inp.reviewsLast180 && inp.repliedLast180 / inp.reviewsLast180 < 0.8) out.push(await upsertRec(businessId, { field: "review_replies", issue: `${inp.reviewsLast180 - inp.repliedLast180} recent reviews without replies`, reason: "Replying to reviews shows customers you are responsive.", impact: "medium", confidence: 0.8, nextAction: "Turn on review replies or answer them in Reviews" }));
  if (inp.unverifiedCriticalFacts) out.push(await upsertRec(businessId, { field: "facts", issue: `${inp.unverifiedCriticalFacts} important facts need confirmation`, reason: "Unconfirmed facts are never used in generated content until a person verifies them.", impact: "medium", confidence: 0.9, requiresFactConfirmation: true, nextAction: "Review facts in Business Knowledge" }));

  // Close recommendations whose gap no longer exists.
  const fields = new Set(out.map((r) => r.field));
  const stale = await db.select().from(profileRecommendations).where(and(eq(profileRecommendations.businessId, businessId), eq(profileRecommendations.status, "open")));
  for (const s of stale) if (!fields.has(s.field)) await db.update(profileRecommendations).set({ status: "superseded", updatedAt: new Date() }).where(eq(profileRecommendations.id, s.id));
  await refreshScore(businessId);
  return out;
}

export async function listRecommendations(actor: Actor, businessId: string, status: "open" | "all" = "open") {
  await requireBusiness(actor, businessId);
  const conds = [eq(profileRecommendations.businessId, businessId)];
  if (status === "open") conds.push(eq(profileRecommendations.status, "open"));
  else conds.push(sql`${profileRecommendations.status} <> 'superseded'`);
  return db.select().from(profileRecommendations).where(and(...conds)).orderBy(sql`case ${profileRecommendations.impact} when 'high' then 0 when 'medium' then 1 else 2 end`, desc(profileRecommendations.createdAt));
}

/** Applies a generated recommendation, optionally with the person's edits. */
export async function applyRecommendation(actor: Actor, businessId: string, recId: string, edited?: unknown) {
  await requireBusiness(actor, businessId, "business.edit");
  const [rec] = await db.select().from(profileRecommendations).where(and(eq(profileRecommendations.id, recId), eq(profileRecommendations.businessId, businessId))).limit(1);
  if (!rec) throw notFound("Recommendation");
  if (rec.status !== "open") throw invalid(`This recommendation is already ${rec.status}`);
  const value = edited ?? rec.proposedValue;
  if (value == null) throw invalid("There is nothing to apply; follow the next step instead");
  let result: Record<string, unknown>;
  if (rec.field === "description") {
    const text = String(value).trim();
    const ctx = await loadBusinessContext(businessId);
    const v = validateContent(text, { kind: "description", maxLength: PLATFORM_LIMITS.gbp_description, facts: ctx.factContext });
    if (!v.ok) throw invalid(v.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "));
    await updateBusiness(actor, businessId, { description: text }, "recommendation");
    result = { applied: "description", length: text.length };
  } else if (rec.field === "service_descriptions") {
    const items = (value as { serviceId: string; description: string }[]) ?? [];
    let n = 0;
    for (const it of items) {
      const [s] = await db.update(businessServices).set({ description: it.description.trim().slice(0, 1000), syncStatus: "pending", updatedAt: new Date() }).where(and(eq(businessServices.id, it.serviceId), eq(businessServices.businessId, businessId))).returning();
      if (s) n++;
    }
    const { enqueue } = await import("../jobs/queue");
    const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
    if (b.gbpLocationName) await enqueue("gbp.pushServices", { businessId }, { idempotencyKey: `gbp-services:${businessId}:${Date.now()}`, businessId });
    result = { applied: "service_descriptions", count: n };
  } else {
    throw invalid("This recommendation needs a person to update the profile directly");
  }
  await db.update(profileRecommendations).set({ status: "applied", appliedAt: new Date(), applyResult: result, updatedAt: new Date() }).where(eq(profileRecommendations.id, rec.id));
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "recommendation.applied", target: { type: "recommendation", id: rec.id }, detail: result });
  await refreshScore(businessId);
  return result;
}

export async function dismissRecommendation(actor: Actor, businessId: string, recId: string) {
  await requireBusiness(actor, businessId, "business.edit");
  await db.update(profileRecommendations).set({ status: "rejected", updatedAt: new Date() }).where(and(eq(profileRecommendations.id, recId), eq(profileRecommendations.businessId, businessId), eq(profileRecommendations.status, "open")));
}
