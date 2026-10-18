import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  AUTOMATION_TYPES,
  automationRules,
  businessAttributes,
  businessKnowledge,
  businessLocations,
  businessServices,
  KNOWLEDGE_CATEGORIES,
  profileChanges,
  reviewPolicies,
  trainingInstructions,
  TRAINING_CATEGORIES,
  type TrainingCategory,
  type WeeklyHours,
} from "../db/schema";
import { assertCan, requireBusiness, type Actor } from "../authz";
import { logActivity, userActor } from "../activity";
import { invalid, notFound } from "../errors";
import { randomToken } from "../security/crypto";
import { slugify } from "@/lib/text";
import { isValidTimeZone } from "@/lib/time";
import { AUTOMATION_META, defaultConfig } from "@/lib/automation-config";
import { RECOMMENDED_REVIEW_POLICIES } from "@/lib/review-policy";
import { computeNextRun } from "@/lib/schedule";
import { detectInstructionConflicts } from "@/lib/content-validation";
import { enqueue } from "../jobs/queue";
import { loadBusinessContext } from "../ai/context";

export const ONBOARDING_STEPS = [
  { key: "connect", label: "Connect Google Business Profile" },
  { key: "details", label: "Confirm business details" },
  { key: "knowledge", label: "Review extracted facts" },
  { key: "services", label: "Services" },
  { key: "keywords", label: "Keywords and audit area" },
  { key: "reviews", label: "Review replies" },
  { key: "posting", label: "Posting preferences" },
  { key: "images", label: "Photos" },
  { key: "social", label: "Social accounts" },
  { key: "approvals", label: "Approvals and notifications" },
  { key: "website", label: "Website and AI search" },
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
export const hoursSchema = z.record(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]), z.array(z.object({ open: hhmm, close: hhmm })).max(3));

export const businessInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  website: z.string().trim().url().max(300).nullish().or(z.literal("").transform(() => null)),
  primaryCategory: z.string().trim().max(120).nullish(),
  secondaryCategories: z.array(z.string().trim().min(1).max(120)).max(9).optional(),
  description: z.string().trim().max(750).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("").transform(() => null)),
  appointmentUrl: z.string().trim().url().max(300).nullish().or(z.literal("").transform(() => null)),
  addressLine1: z.string().trim().max(200).nullish(),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(120).nullish(),
  region: z.string().trim().max(120).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  country: z.string().trim().max(2).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  isServiceAreaBusiness: z.boolean().optional(),
  hideAddress: z.boolean().optional(),
  serviceAreaPlaces: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  hours: hoursSchema.nullish(),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone").optional(),
  averageCustomerValue: z.number().min(0).max(1_000_000).nullish(),
  brandPrimaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  brandVoice: z.string().max(400).nullish(),
  googleReviewUrl: z.string().url().refine((u) => u.startsWith("https://"), "The review link must start with https://").nullish().or(z.literal("").transform(() => null)),
  clientId: z.string().uuid().nullish(),
});
export type BusinessInput = z.infer<typeof businessInputSchema>;

async function uniqueReviewSlug(name: string) {
  const base = slugify(name, 40);
  for (let i = 0; i < 30; i++) {
    const s = i === 0 ? base : `${base}-${i + 1}`;
    const [e] = await db.select({ id: businessLocations.id }).from(businessLocations).where(eq(businessLocations.reviewSlug, s)).limit(1);
    if (!e) return s;
  }
  return `${base}-${randomToken(4).toLowerCase()}`;
}

function toColumns(input: Partial<BusinessInput>) {
  const out: Partial<typeof businessLocations.$inferInsert> = {};
  const direct = ["name", "website", "primaryCategory", "secondaryCategories", "description", "phone", "email", "appointmentUrl", "addressLine1", "addressLine2", "city", "region", "postalCode", "country", "latitude", "longitude", "isServiceAreaBusiness", "hideAddress", "timezone", "googleReviewUrl", "clientId"] as const;
  for (const k of direct) if (k in input) (out as Record<string, unknown>)[k] = (input as Record<string, unknown>)[k] ?? null;
  if ("hours" in input) out.hours = (input.hours ?? null) as WeeklyHours | null;
  if ("serviceAreaPlaces" in input) out.serviceArea = { places: input.serviceAreaPlaces ?? [] };
  if ("averageCustomerValue" in input) out.averageCustomerValue = input.averageCustomerValue == null ? null : String(input.averageCustomerValue);
  return out;
}

export async function createBusiness(actor: Actor, raw: unknown) {
  assertCan(actor, "business.create");
  const input = businessInputSchema.parse(raw);
  if (actor.clientIds !== null) throw invalid("Client-scoped members cannot create businesses");
  const reviewSlug = await uniqueReviewSlug(input.name);
  const business = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(businessLocations)
      .values({ ...(toColumns(input) as typeof businessLocations.$inferInsert), orgId: actor.orgId, name: input.name, reviewSlug, brand: { primaryColor: input.brandPrimaryColor ?? undefined, voice: input.brandVoice ?? undefined } })
      .returning();
    // Review policies start in approval mode until the owner chooses otherwise.
    await tx.insert(reviewPolicies).values([1, 2, 3, 4, 5].map((rating) => ({ businessId: b.id, rating, mode: "approval" as const, escalate: rating <= 2 })));
    await tx.insert(automationRules).values(
      AUTOMATION_TYPES.map((type) => ({ businessId: b.id, type, enabled: false, schedule: AUTOMATION_META[type].defaultSchedule, config: defaultConfig(type), approvalMode: "all" })),
    );
    return b;
  });
  await logActivity({ orgId: actor.orgId, businessId: business.id, actor: userActor(actor.userId), action: "business.created", target: { type: "business", id: business.id } });
  return business;
}

const SYNCABLE_FIELDS = new Set(["name", "description", "phone", "website", "primaryCategory", "hours", "appointmentUrl"]);

/** Updates business facts, records a change log entry per field and queues Google sync where supported. */
export async function updateBusiness(actor: Actor, businessId: string, raw: unknown, origin: "user" | "onboarding" | "recommendation" = "user") {
  const before = await requireBusiness(actor, businessId, "business.edit");
  const input = businessInputSchema.partial().parse(raw);
  const cols = toColumns(input);
  if (input.brandPrimaryColor !== undefined || input.brandVoice !== undefined) {
    cols.brand = { ...(before.brand ?? {}), primaryColor: input.brandPrimaryColor ?? before.brand?.primaryColor, voice: input.brandVoice ?? before.brand?.voice };
  }
  const changed: string[] = [];
  for (const [k, v] of Object.entries(cols)) {
    const prev = (before as Record<string, unknown>)[k];
    if (JSON.stringify(prev ?? null) !== JSON.stringify(v ?? null)) changed.push(k);
  }
  if (changed.length === 0) return before;
  const [after] = await db.update(businessLocations).set({ ...cols, updatedAt: new Date() }).where(eq(businessLocations.id, businessId)).returning();
  const googleConnected = Boolean(after.gbpLocationName && after.googleIntegrationId);
  for (const field of changed) {
    const syncable = SYNCABLE_FIELDS.has(field);
    const [change] = await db
      .insert(profileChanges)
      .values({
        businessId,
        field,
        before: (before as Record<string, unknown>)[field] ?? null,
        after: (after as Record<string, unknown>)[field] ?? null,
        origin,
        actorUserId: actor.userId,
        syncStatus: googleConnected ? (syncable ? "pending" : "unsupported") : "local_only",
      })
      .returning();
    if (googleConnected && syncable) await enqueue("gbp.pushProfileChange", { changeId: change.id }, { idempotencyKey: `gbp-change:${change.id}`, businessId, orgId: actor.orgId });
  }
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "business.updated", target: { type: "business", id: businessId }, detail: { fields: changed } });
  return after;
}

export async function listProfileChanges(actor: Actor, businessId: string, limit = 50) {
  await requireBusiness(actor, businessId);
  return db.select().from(profileChanges).where(eq(profileChanges.businessId, businessId)).orderBy(desc(profileChanges.createdAt)).limit(limit);
}

export async function archiveBusiness(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId, "business.create");
  await db.update(businessLocations).set({ status: "archived", updatedAt: new Date() }).where(eq(businessLocations.id, businessId));
  await db.update(automationRules).set({ enabled: false }).where(eq(automationRules.businessId, businessId));
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "business.archived" });
}

/* ---------------- Knowledge ---------------- */

export const knowledgeInputSchema = z.object({
  category: z.enum(KNOWLEDGE_CATEGORIES),
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(2000),
  isPublic: z.boolean().default(true),
});

export async function listKnowledge(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(businessKnowledge).where(eq(businessKnowledge.businessId, businessId)).orderBy(asc(businessKnowledge.category), asc(businessKnowledge.key));
}

/** Facts typed in by an owner are verified; imported or extracted facts wait for confirmation. */
export async function upsertKnowledge(actor: Actor, businessId: string, raw: unknown, source: "user" | "website" | "gbp" | "ai_extracted" | "import" = "user", sourceRef?: string) {
  await requireBusiness(actor, businessId, "business.edit");
  const input = knowledgeInputSchema.parse(raw);
  const verified = source === "user";
  const [row] = await db
    .insert(businessKnowledge)
    .values({
      businessId,
      ...input,
      source,
      sourceRef: sourceRef ?? null,
      verificationStatus: verified ? "verified" : "unverified",
      requiresConfirmation: !verified,
      verifiedByUserId: verified ? actor.userId : null,
      verifiedAt: verified ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [businessKnowledge.businessId, businessKnowledge.category, businessKnowledge.key],
      set: {
        value: input.value,
        isPublic: input.isPublic,
        source,
        sourceRef: sourceRef ?? null,
        ...(verified ? { verificationStatus: "verified" as const, verifiedByUserId: actor.userId, verifiedAt: new Date(), requiresConfirmation: false } : {}),
        updatedAt: new Date(),
      },
      // Imported or extracted values never overwrite a fact a person already verified.
      ...(verified ? {} : { setWhere: sql`${businessKnowledge.verificationStatus} <> 'verified'` }),
    })
    .returning();
  if (!row) {
    const [existing] = await db.select().from(businessKnowledge).where(and(eq(businessKnowledge.businessId, businessId), eq(businessKnowledge.category, input.category), eq(businessKnowledge.key, input.key))).limit(1);
    return existing;
  }
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "knowledge.upserted", target: { type: "knowledge", id: row.id }, detail: { source, key: input.key } });
  await markFaqsStale(businessId);
  return row;
}

export async function setKnowledgeVerification(actor: Actor, businessId: string, knowledgeId: string, status: "verified" | "rejected", value?: string) {
  await requireBusiness(actor, businessId, "business.edit");
  const [row] = await db
    .update(businessKnowledge)
    .set({ verificationStatus: status, ...(value ? { value } : {}), requiresConfirmation: false, verifiedByUserId: actor.userId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(businessKnowledge.id, knowledgeId), eq(businessKnowledge.businessId, businessId)))
    .returning();
  if (!row) throw notFound("Fact");
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: `knowledge.${status}`, target: { type: "knowledge", id: knowledgeId } });
  await markFaqsStale(businessId);
  return row;
}

export async function deleteKnowledge(actor: Actor, businessId: string, knowledgeId: string) {
  await requireBusiness(actor, businessId, "business.edit");
  await db.delete(businessKnowledge).where(and(eq(businessKnowledge.id, knowledgeId), eq(businessKnowledge.businessId, businessId)));
  await markFaqsStale(businessId);
}

async function markFaqsStale(businessId: string) {
  await db.execute(sql`update faqs set stale_since = coalesce(stale_since, now()) where business_id = ${businessId} and status in ('approved','published')`);
}

/* ---------------- Services ---------------- */

export async function listServices(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(businessServices).where(eq(businessServices.businessId, businessId)).orderBy(asc(businessServices.status), asc(businessServices.name));
}

export const serviceInputSchema = z.object({ name: z.string().trim().min(2).max(120), category: z.string().trim().max(120).nullish(), description: z.string().trim().max(1000).nullish() });

export async function addService(actor: Actor, businessId: string, raw: unknown) {
  const b = await requireBusiness(actor, businessId, "business.edit");
  const input = serviceInputSchema.parse(raw);
  const exists = await db.select({ id: businessServices.id }).from(businessServices).where(and(eq(businessServices.businessId, businessId), sql`lower(${businessServices.name}) = ${input.name.toLowerCase()}`, sql`${businessServices.status} <> 'removed'`)).limit(1);
  if (exists[0]) throw invalid("A service with this name already exists");
  const [row] = await db
    .insert(businessServices)
    .values({ businessId, name: input.name, category: input.category ?? null, description: input.description ?? null, source: "user", status: "active", syncStatus: b.gbpLocationName ? "pending" : "local_only" })
    .returning();
  if (b.gbpLocationName) await enqueue("gbp.pushServices", { businessId }, { idempotencyKey: `gbp-services:${businessId}:${Date.now()}`, businessId, orgId: b.orgId, runAt: new Date(Date.now() + 5000) });
  return row;
}

export async function updateService(actor: Actor, businessId: string, serviceId: string, raw: unknown) {
  const b = await requireBusiness(actor, businessId, "business.edit");
  const input = serviceInputSchema.partial().parse(raw);
  const [row] = await db
    .update(businessServices)
    .set({ ...input, syncStatus: b.gbpLocationName ? "pending" : "local_only", updatedAt: new Date() })
    .where(and(eq(businessServices.id, serviceId), eq(businessServices.businessId, businessId)))
    .returning();
  if (!row) throw notFound("Service");
  if (b.gbpLocationName) await enqueue("gbp.pushServices", { businessId }, { idempotencyKey: `gbp-services:${businessId}:${Date.now()}`, businessId, orgId: b.orgId, runAt: new Date(Date.now() + 5000) });
  return row;
}

/** Resolves AI-proposed additions/removals; only approved proposals change the active list. */
export async function decideService(actor: Actor, businessId: string, serviceId: string, decision: "approve" | "reject" | "remove") {
  const b = await requireBusiness(actor, businessId, "business.edit");
  const [svc] = await db.select().from(businessServices).where(and(eq(businessServices.id, serviceId), eq(businessServices.businessId, businessId))).limit(1);
  if (!svc) throw notFound("Service");
  let status = svc.status;
  if (decision === "remove") status = "removed";
  else if (svc.status === "proposed_add") status = decision === "approve" ? "active" : "rejected";
  else if (svc.status === "proposed_remove") status = decision === "approve" ? "removed" : "active";
  else if (decision === "reject") throw invalid("Only proposals can be rejected");
  await db.update(businessServices).set({ status, syncStatus: b.gbpLocationName ? "pending" : "local_only", updatedAt: new Date() }).where(eq(businessServices.id, serviceId));
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: `service.${decision}`, target: { type: "service", id: serviceId }, detail: { name: svc.name, status } });
  if (b.gbpLocationName) await enqueue("gbp.pushServices", { businessId }, { idempotencyKey: `gbp-services:${businessId}:${Date.now()}`, businessId, orgId: b.orgId, runAt: new Date(Date.now() + 5000) });
}

export async function bulkApplyServiceProposals(actor: Actor, businessId: string) {
  const rows = await db.select().from(businessServices).where(and(eq(businessServices.businessId, businessId), sql`${businessServices.status} in ('proposed_add','proposed_remove')`));
  for (const r of rows) await decideService(actor, businessId, r.id, "approve");
  return rows.length;
}

/* ---------------- Attributes ---------------- */

export async function listAttributes(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(businessAttributes).where(eq(businessAttributes.businessId, businessId)).orderBy(asc(businessAttributes.groupName), asc(businessAttributes.displayName));
}

/** Attribute values are factual claims and require explicit confirmation by a person. */
export async function confirmAttribute(actor: Actor, businessId: string, attributeId: string, decision: "confirm" | "reject", value?: boolean) {
  const b = await requireBusiness(actor, businessId, "business.edit");
  const [row] = await db
    .update(businessAttributes)
    .set({
      status: decision === "confirm" ? "confirmed" : "rejected",
      value: decision === "confirm" ? (value ?? true) : null,
      confirmedByUserId: actor.userId,
      confirmedAt: new Date(),
      syncStatus: decision === "confirm" && b.gbpLocationName ? "pending" : "local_only",
    })
    .where(and(eq(businessAttributes.id, attributeId), eq(businessAttributes.businessId, businessId)))
    .returning();
  if (!row) throw notFound("Attribute");
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: `attribute.${decision}`, target: { type: "attribute", id: attributeId }, detail: { key: row.attributeKey } });
  if (decision === "confirm" && b.gbpLocationName) await enqueue("gbp.pushAttributes", { businessId }, { idempotencyKey: `gbp-attrs:${businessId}:${Date.now()}`, businessId, orgId: b.orgId });
  return row;
}

/* ---------------- Train AI ---------------- */

export async function listTraining(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  const rows = await db.select().from(trainingInstructions).where(eq(trainingInstructions.businessId, businessId)).orderBy(asc(trainingInstructions.category), desc(trainingInstructions.version));
  const byCat: Record<string, typeof rows> = {};
  for (const r of rows) (byCat[r.category] ??= []).push(r);
  return byCat;
}

export async function saveTraining(actor: Actor, businessId: string, category: TrainingCategory, content: string) {
  await requireBusiness(actor, businessId, "training.edit");
  if (!TRAINING_CATEGORIES.includes(category)) throw invalid("Unknown category");
  const text = content.trim();
  if (text.length > 4000) throw invalid("Instructions are limited to 4,000 characters per category");
  const ctx = await loadBusinessContext(businessId);
  const warnings = detectInstructionConflicts(text, ctx.factContext);
  const row = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ v: trainingInstructions.version })
      .from(trainingInstructions)
      .where(and(eq(trainingInstructions.businessId, businessId), eq(trainingInstructions.category, category)))
      .orderBy(desc(trainingInstructions.version))
      .limit(1);
    await tx.update(trainingInstructions).set({ isActive: false }).where(and(eq(trainingInstructions.businessId, businessId), eq(trainingInstructions.category, category)));
    const [r] = await tx.insert(trainingInstructions).values({ businessId, category, version: (last?.v ?? 0) + 1, content: text, isActive: text.length > 0, createdByUserId: actor.userId }).returning();
    return r;
  });
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "training.saved", target: { type: "training", id: row.id }, detail: { category, version: row.version } });
  return { row, warnings };
}

export async function restoreTrainingVersion(actor: Actor, businessId: string, versionId: string) {
  await requireBusiness(actor, businessId, "training.edit");
  const [v] = await db.select().from(trainingInstructions).where(and(eq(trainingInstructions.id, versionId), eq(trainingInstructions.businessId, businessId))).limit(1);
  if (!v) throw notFound("Version");
  return saveTraining(actor, businessId, v.category, v.content);
}

/* ---------------- Onboarding ---------------- */

export async function setOnboardingStep(actor: Actor, businessId: string, step: OnboardingStepKey, status: "done" | "skipped" | "todo") {
  const b = await requireBusiness(actor, businessId, "business.edit");
  const onboarding = { ...b.onboarding, steps: { ...b.onboarding.steps, [step]: { status, updatedAt: new Date().toISOString() } } };
  const allDone = ONBOARDING_STEPS.every((s) => ["done", "skipped"].includes(onboarding.steps[s.key]?.status ?? "todo"));
  await db.update(businessLocations).set({ onboarding, onboardingCompletedAt: allDone ? (b.onboardingCompletedAt ?? new Date()) : null, updatedAt: new Date() }).where(eq(businessLocations.id, businessId));
}

export type TrustPlanItem = { type: string; label: string; enable: boolean; publishesAutomatically: boolean; detail: string };

/** The recommended-settings plan shown before the owner accepts it. Nothing changes until they confirm. */
export function recommendedPlan(): { automations: TrustPlanItem[]; reviewPolicies: typeof RECOMMENDED_REVIEW_POLICIES } {
  return {
    automations: AUTOMATION_TYPES.map((t) => ({
      type: t,
      label: AUTOMATION_META[t].label,
      enable: AUTOMATION_META[t].recommendedEnabled,
      publishesAutomatically: t === "review_replies" || t === "historical_reviews",
      detail:
        t === "posting"
          ? "Posts are generated and wait for your approval before publishing."
          : t === "review_replies"
            ? "5-star replies publish automatically; 1-4 star replies wait for approval; 1-2 star reviews are flagged to you."
            : AUTOMATION_META[t].description,
    })),
    reviewPolicies: RECOMMENDED_REVIEW_POLICIES,
  };
}

export async function applyRecommendedSettings(actor: Actor, businessId: string, accepted: string[]) {
  const b = await requireBusiness(actor, businessId, "automations.manage");
  const plan = recommendedPlan();
  for (const p of plan.reviewPolicies) {
    await db
      .insert(reviewPolicies)
      .values({ businessId, rating: p.rating, mode: p.mode, escalate: Boolean(p.escalate) })
      .onConflictDoUpdate({ target: [reviewPolicies.businessId, reviewPolicies.rating], set: { mode: p.mode, escalate: Boolean(p.escalate), updatedAt: new Date() } });
  }
  const now = new Date();
  for (const item of plan.automations) {
    const enable = item.enable && accepted.includes(item.type);
    const schedule = AUTOMATION_META[item.type as (typeof AUTOMATION_TYPES)[number]].defaultSchedule;
    await db
      .update(automationRules)
      .set({ enabled: enable, schedule, approvalMode: "all", nextRunAt: enable ? computeNextRun(schedule, b.timezone, now) : null, updatedByUserId: actor.userId, updatedAt: now })
      .where(and(eq(automationRules.businessId, businessId), eq(automationRules.type, item.type as (typeof AUTOMATION_TYPES)[number])));
  }
  await db.update(businessLocations).set({ onboarding: { ...b.onboarding, trustDefaultsApplied: true } }).where(eq(businessLocations.id, businessId));
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "settings.recommended_applied", detail: { accepted } });
}
