import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { automationRules, businessLocations, contentItems, mediaAssets, publicationJobs, type AutomationSchedule, type BrandingOptions } from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { invalid, notFound } from "../errors";
import { sha256 } from "../security/crypto";
import { loadBusinessContext, type BusinessContext } from "../ai/context";
import { generateGbpPost } from "../ai/tasks";
import { PLATFORM_LIMITS, validateContent } from "@/lib/content-validation";
import { finalApprovalDecision, postRequiresApproval, type PostApprovalMode } from "@/lib/approval-policy";
import { postingConfig } from "@/lib/automation-config";
import { computeNextRun } from "@/lib/schedule";
import { upcomingHoliday } from "@/lib/holidays";
import { isoDate, toLocalParts } from "@/lib/time";
import { createBrandedImage, recordMediaUsage, selectImageForPost, type MediaAsset } from "./media";
import { createTask, registerTaskHandler, type TaskRow } from "./tasks";
import { publishContentItem } from "./publishing";
import { recordAiUsage } from "./usage";
import { publicMediaUrl } from "../storage";

export type ContentItem = typeof contentItems.$inferSelect;
export type PostingConfig = z.infer<typeof postingConfig>;

const IMAGE_SOURCES: Record<PostingConfig["imageSource"], MediaAsset["source"][]> = {
  uploaded_only: ["upload", "upload_link", "companycam", "photo_boost"],
  uploaded_then_gbp: ["upload", "upload_link", "companycam", "photo_boost", "gbp"],
  allow_ai: ["upload", "upload_link", "companycam", "photo_boost", "gbp", "ai_generated"],
};

const DEST_LIMIT: Record<string, number> = { google: PLATFORM_LIMITS.gbp_post, facebook: PLATFORM_LIMITS.facebook, instagram: PLATFORM_LIMITS.instagram, linkedin: PLATFORM_LIMITS.linkedin };

export function contentHash(body: string, mediaAssetId: string | null, cta: string | null) {
  return sha256(`${body.trim()}|${mediaAssetId ?? ""}|${cta ?? ""}`);
}

async function recentBodies(businessId: string, excludeId?: string) {
  const rows = await db
    .select({ id: contentItems.id, body: contentItems.body })
    .from(contentItems)
    .where(and(eq(contentItems.businessId, businessId), eq(contentItems.type, "gbp_post"), inArray(contentItems.status, ["published", "scheduled", "approved", "pending_approval", "publishing", "partially_published"])))
    .orderBy(desc(contentItems.createdAt))
    .limit(12);
  return rows.filter((r) => r.id !== excludeId).map((r) => r.body);
}

export function validatePost(ctx: BusinessContext, body: string, destinations: string[], recent: string[]) {
  const maxLength = Math.min(...destinations.map((d) => DEST_LIMIT[d] ?? PLATFORM_LIMITS.gbp_post));
  const v = validateContent(body, { kind: "gbp_post", maxLength, facts: ctx.factContext, recentContent: recent });
  if (destinations.includes("google") && /https?:\/\/|www\./i.test(body)) {
    v.issues.push({ code: "url_in_google_post", severity: "warning", message: "Google may reject posts containing links in the text; use the button instead" });
  }
  return v;
}

/** Upcoming publishing slots from the posting schedule that are not already taken. */
export async function nextOpenSlots(businessId: string, schedule: AutomationSchedule, tz: string, count: number, from = new Date()) {
  const taken = await db
    .select({ at: contentItems.scheduledFor })
    .from(contentItems)
    .where(and(eq(contentItems.businessId, businessId), eq(contentItems.type, "gbp_post"), isNotNull(contentItems.scheduledFor), gte(contentItems.scheduledFor, from), ne(contentItems.status, "rejected"), ne(contentItems.status, "skipped")));
  const takenSet = new Set(taken.map((t) => t.at!.toISOString()));
  const out: Date[] = [];
  let cursor = from;
  for (let i = 0; i < 200 && out.length < count; i++) {
    const next = computeNextRun(schedule, tz, cursor);
    if (!takenSet.has(next.toISOString())) out.push(next);
    cursor = new Date(next.getTime() + 60_000);
  }
  return out;
}

type DraftInput = {
  ctx: BusinessContext;
  config: PostingConfig;
  scheduledFor: Date | null;
  seed: number;
  excludeImageIds: string[];
  executionId?: string | null;
  createdByUserId?: string | null;
  focus?: { keyword?: string | null; service?: string | null };
};

/** Generates one post: picks an image under the reuse rule, writes copy, validates, decides approval. */
export async function draftPost(input: DraftInput) {
  const { ctx, config } = input;
  const b = ctx.business;
  const kw = input.focus?.keyword ?? (ctx.keywords.length ? ctx.keywords[input.seed % ctx.keywords.length].phrase : null);
  const svc = input.focus?.service ?? (ctx.services.length ? ctx.services[(input.seed + 1) % ctx.services.length].name : null);

  let image = await selectImageForPost(b.id, { sources: IMAGE_SOURCES[config.imageSource], reuseDays: config.imageReuseDays, excludeIds: input.excludeImageIds });
  const notes: string[] = [];
  if (!image) notes.push(config.imageSource === "allow_ai" ? "No eligible photo, and no image-generation provider is configured, so this post has no image." : "No photo is eligible under the reuse rule, so this post has no image.");

  const localDate = isoDate(input.scheduledFor ?? new Date());
  const holiday = config.holidayReferences ? upcomingHoliday(localDate, 2)?.name ?? null : null;
  const recent = await recentBodies(b.id);
  const gen = await generateGbpPost(ctx, { keyword: kw, service: svc, imageDescription: image?.description ?? image?.altText ?? null, holiday, recentPosts: recent, seed: input.seed });
  await recordAiUsage(b.orgId, b.id, gen.meta);

  const sourceImage = image;
  let imageMode: ContentItem["imageMode"] = image ? "raw" : "none";
  let branding: BrandingOptions | null = null;
  if (image && config.imageMode === "branded") {
    branding = { logoPosition: b.logoAssetId ? "top-right" : "none", textPosition: "bottom", cta: config.cta, customCta: config.customCtaText, overlayOpacity: 0.6 };
    try {
      image = await createBrandedImage(image.id, branding);
      imageMode = "branded";
    } catch (e) {
      notes.push(`Branded image could not be created (${(e as Error).message}); the original photo is used.`);
    }
  }
  const imageSource: ContentItem["imageSource"] = !sourceImage ? "none" : sourceImage.source === "ai_generated" ? "ai_generated" : sourceImage.source === "gbp" ? "gbp" : "uploaded";
  const validation = validatePost(ctx, gen.body, config.destinations, recent);
  const decision = finalApprovalDecision(postRequiresApproval(config.approvalMode as PostApprovalMode, { imageMode, imageSource }), validation);
  const cta = config.cta === "CALL" && !b.phone ? "LEARN_MORE" : config.cta;
  const [item] = await db
    .insert(contentItems)
    .values({
      businessId: b.id,
      type: "gbp_post",
      body: gen.body,
      ctaType: cta,
      ctaUrl: cta === "BOOK" ? (b.appointmentUrl ?? b.website) : b.website,
      mediaAssetId: image?.id ?? null,
      imageMode,
      branding,
      imageSource,
      destinations: config.destinations,
      status: decision.required ? "pending_approval" : "approved",
      scheduledFor: input.scheduledFor,
      approvalRequired: decision.required,
      approvalReason: decision.reason,
      holiday,
      contentHash: contentHash(gen.body, image?.id ?? null, cta),
      validation,
      generation: { ...gen.meta, angle: gen.angle, keyword: kw, service: svc, notes, sourceImageId: sourceImage?.id ?? null },
      automationExecutionId: input.executionId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();
  if (sourceImage) await recordMediaUsage(sourceImage.id, b.id, "post", item.id);
  return item;
}

async function routeForApproval(item: ContentItem, rule: { notificationRecipients: string[]; showTasksInDashboard: boolean } | null, createdBy = "system") {
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, item.businessId)).limit(1);
  if (item.status === "pending_approval") {
    const task = await createTask({
      orgId: b.orgId,
      businessId: b.id,
      type: "post",
      title: item.scheduledFor ? `Approve post for ${item.scheduledFor.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: b.timezone })}` : "Approve post",
      summary: item.approvalReason ?? undefined,
      refType: "content_item",
      refId: item.id,
      dueAt: item.scheduledFor,
      notificationRecipients: rule?.notificationRecipients ?? [],
      visibleInDashboard: rule?.showTasksInDashboard ?? true,
      createdBy,
    });
    await db.update(contentItems).set({ taskId: task.id }).where(eq(contentItems.id, item.id));
    return { task };
  }
  await publishContentItem(item.id);
  return { task: null };
}

/**
 * Keeps a buffer of upcoming posts for the posting automation: fills the next
 * open schedule slots up to the batch size.
 */
export async function generatePostBatch(businessId: string, opts: { executionId?: string | null; count?: number; actorUserId?: string | null }) {
  const [rule] = await db.select().from(automationRules).where(and(eq(automationRules.businessId, businessId), eq(automationRules.type, "posting"))).limit(1);
  if (!rule) throw notFound("Posting automation");
  const config = postingConfig.parse(rule.config ?? {});
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const upcoming = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(and(eq(contentItems.businessId, businessId), eq(contentItems.type, "gbp_post"), inArray(contentItems.status, ["pending_approval", "approved", "scheduled"]), gte(contentItems.scheduledFor, new Date())));
  const wanted = Math.max(0, (opts.count ?? config.batchSize) - (opts.count ? 0 : upcoming.length));
  if (!wanted) return { created: 0, reason: "Enough upcoming posts are already scheduled" };
  const slots = await nextOpenSlots(businessId, rule.schedule, b.timezone, wanted);
  const ctx = await loadBusinessContext(businessId, ["google_posts"]);
  const created: ContentItem[] = [];
  const usedImages: string[] = [];
  const seedBase = Math.floor(Date.now() / 86400_000);
  for (let i = 0; i < slots.length; i++) {
    const item = await draftPost({ ctx, config, scheduledFor: slots[i], seed: seedBase + i, excludeImageIds: usedImages, executionId: opts.executionId, createdByUserId: opts.actorUserId });
    const src = (item.generation as { sourceImageId?: string | null } | null)?.sourceImageId;
    if (src) usedImages.push(src);
    await routeForApproval(item, rule, opts.actorUserId ?? "system");
    created.push(item);
  }
  await logActivity({ orgId: b.orgId, businessId, actor: opts.actorUserId ? userActor(opts.actorUserId) : systemActor, action: "posts.batch_generated", detail: { count: created.length, needsApproval: created.filter((c) => c.status === "pending_approval").length } });
  return { created: created.length, items: created };
}

/* ---------------- Manual posts and editing ---------------- */

export const postInputSchema = z.object({
  body: z.string().trim().min(1).max(PLATFORM_LIMITS.facebook),
  mediaAssetId: z.string().uuid().nullable().optional(),
  ctaType: z.enum(["NONE", "LEARN_MORE", "CALL", "BOOK", "ORDER", "SHOP", "SIGN_UP"]).default("LEARN_MORE"),
  ctaUrl: z.string().url().nullable().optional(),
  destinations: z.array(z.enum(["google", "facebook", "instagram", "linkedin"])).min(1).default(["google"]),
  scheduledFor: z.coerce.date().nullable().optional(),
  requestApproval: z.boolean().default(false),
});

export async function createManualPost(actor: Actor, businessId: string, raw: unknown) {
  const b = await requireBusiness(actor, businessId, "content.create");
  const input = postInputSchema.parse(raw);
  let asset: MediaAsset | null = null;
  if (input.mediaAssetId) {
    [asset] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, input.mediaAssetId), eq(mediaAssets.businessId, businessId)));
    if (!asset) throw invalid("Choose a photo from this business's library");
    if (asset.moderationStatus !== "approved") throw invalid("That photo has not been approved yet");
  }
  const ctx = await loadBusinessContext(businessId, ["google_posts"]);
  const validation = validatePost(ctx, input.body, input.destinations, await recentBodies(businessId));
  const canApprove = ["owner", "admin", "member"].includes(actor.role);
  const needsApproval = input.requestApproval || !validation.ok || !canApprove;
  const [item] = await db
    .insert(contentItems)
    .values({
      businessId,
      type: "gbp_post",
      body: input.body,
      ctaType: input.ctaType,
      ctaUrl: input.ctaUrl ?? b.website,
      mediaAssetId: asset?.id ?? null,
      imageMode: asset ? (asset.source === "branded" ? "branded" : "raw") : "none",
      imageSource: asset ? (asset.source === "gbp" ? "gbp" : asset.isAiGenerated ? "ai_generated" : "uploaded") : "none",
      destinations: input.destinations,
      status: needsApproval ? "pending_approval" : "approved",
      scheduledFor: input.scheduledFor ?? null,
      approvalRequired: needsApproval,
      approvalReason: !validation.ok ? "Validation found issues" : input.requestApproval ? "Approval requested" : null,
      contentHash: contentHash(input.body, asset?.id ?? null, input.ctaType),
      validation,
      generation: { origin: "manual" },
      createdByUserId: actor.userId,
    })
    .returning();
  if (asset) await recordMediaUsage(asset.id, businessId, "post", item.id);
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "post.created", target: { type: "content_item", id: item.id } });
  await routeForApproval(item, null, actor.userId);
  return item;
}

async function requirePost(actor: Actor, businessId: string, id: string) {
  await requireBusiness(actor, businessId);
  const [item] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.businessId, businessId))).limit(1);
  if (!item) throw notFound("Post");
  return item;
}

const EDITABLE: ContentItem["status"][] = ["draft", "pending_approval", "approved", "scheduled", "failed"];

export async function editPostBody(item: ContentItem, body: string) {
  if (!EDITABLE.includes(item.status)) throw invalid(`A ${item.status.replace("_", " ")} post cannot be edited`);
  const ctx = await loadBusinessContext(item.businessId, ["google_posts"]);
  const validation = validatePost(ctx, body, item.destinations, await recentBodies(item.businessId, item.id));
  const [updated] = await db
    .update(contentItems)
    .set({ body: body.trim(), validation, contentHash: contentHash(body, item.mediaAssetId, item.ctaType), generation: { ...(item.generation ?? {}), editedByPerson: true }, updatedAt: new Date() })
    .where(eq(contentItems.id, item.id))
    .returning();
  return updated;
}

export async function updatePost(actor: Actor, businessId: string, id: string, patch: { body?: string; scheduledFor?: Date | null; mediaAssetId?: string | null; destinations?: string[] }) {
  await requireBusiness(actor, businessId, "content.create");
  let item = await requirePost(actor, businessId, id);
  if (patch.body !== undefined && patch.body !== item.body) item = await editPostBody(item, patch.body);
  const set: Partial<ContentItem> = { updatedAt: new Date() };
  if (patch.scheduledFor !== undefined) set.scheduledFor = patch.scheduledFor;
  if (patch.destinations) set.destinations = postInputSchema.shape.destinations.parse(patch.destinations);
  if (patch.mediaAssetId !== undefined) {
    if (patch.mediaAssetId) {
      const [a] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, patch.mediaAssetId), eq(mediaAssets.businessId, businessId)));
      if (!a || a.moderationStatus !== "approved") throw invalid("Choose an approved photo from this business's library");
      set.imageMode = a.source === "branded" ? "branded" : "raw";
      set.imageSource = a.source === "gbp" ? "gbp" : a.isAiGenerated ? "ai_generated" : "uploaded";
    } else {
      set.imageMode = "none";
      set.imageSource = "none";
    }
    set.mediaAssetId = patch.mediaAssetId;
    set.contentHash = contentHash(item.body, patch.mediaAssetId, item.ctaType);
  }
  const [updated] = await db.update(contentItems).set(set).where(eq(contentItems.id, id)).returning();
  // A scheduled post's queued publications are tied to the old content; requeue with the new content.
  if (["approved", "scheduled"].includes(updated.status) && (patch.body !== undefined || patch.scheduledFor !== undefined || patch.mediaAssetId !== undefined || patch.destinations)) {
    await db.update(publicationJobs).set({ status: "cancelled", lastError: "Superseded by an edit" }).where(and(eq(publicationJobs.refType, "content_item"), eq(publicationJobs.refId, id), eq(publicationJobs.status, "queued")));
    await db.update(contentItems).set({ status: "approved" }).where(eq(contentItems.id, id));
    await publishContentItem(id);
  }
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "post.updated", target: { type: "content_item", id }, detail: { fields: Object.keys(patch) } });
  return updated;
}

export async function cancelPost(actor: Actor, businessId: string, id: string) {
  await requireBusiness(actor, businessId, "content.create");
  const item = await requirePost(actor, businessId, id);
  if (["published", "publishing", "partially_published"].includes(item.status)) throw invalid("Published posts must be removed on the platform itself");
  await db.update(publicationJobs).set({ status: "cancelled", lastError: "Cancelled by a person" }).where(and(eq(publicationJobs.refType, "content_item"), eq(publicationJobs.refId, id), eq(publicationJobs.status, "queued")));
  await db.update(contentItems).set({ status: "skipped", updatedAt: new Date() }).where(eq(contentItems.id, id));
  const { completeTaskForRef } = await import("./tasks");
  await completeTaskForRef("content_item", id, { cancelled: true }, "cancelled");
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "post.cancelled", target: { type: "content_item", id } });
}

export async function publishNow(actor: Actor, businessId: string, id: string) {
  await requireBusiness(actor, businessId, "content.approve");
  const item = await requirePost(actor, businessId, id);
  if (item.status === "pending_approval") throw invalid("Approve the post first");
  if (!item.validation?.ok) throw invalid("Fix the validation issues before publishing");
  await db.update(publicationJobs).set({ status: "cancelled", lastError: "Replaced by publish now" }).where(and(eq(publicationJobs.refType, "content_item"), eq(publicationJobs.refId, id), eq(publicationJobs.status, "queued")));
  await db.update(contentItems).set({ scheduledFor: new Date(), status: "approved", contentHash: sha256(`${item.contentHash}:${Date.now()}`) }).where(eq(contentItems.id, id));
  return publishContentItem(id);
}

export async function listPosts(actor: Actor, businessId: string, status?: string) {
  await requireBusiness(actor, businessId);
  const conds = [eq(contentItems.businessId, businessId), eq(contentItems.type, "gbp_post")];
  if (status && status !== "all") conds.push(eq(contentItems.status, status as ContentItem["status"]));
  const rows = await db.select().from(contentItems).where(and(...conds)).orderBy(sql`coalesce(${contentItems.scheduledFor}, ${contentItems.createdAt}) desc`).limit(200);
  const pubs = rows.length ? await db.select().from(publicationJobs).where(and(eq(publicationJobs.refType, "content_item"), inArray(publicationJobs.refId, rows.map((r) => r.id)))) : [];
  return rows.map((r) => ({ ...r, publications: pubs.filter((p) => p.refId === r.id) }));
}

export async function getPost(actor: Actor, businessId: string, id: string) {
  const item = await requirePost(actor, businessId, id);
  const pubs = await db.select().from(publicationJobs).where(and(eq(publicationJobs.refType, "content_item"), eq(publicationJobs.refId, id)));
  return { item, publications: pubs };
}

/** Regenerates the copy of a draft or pending post, keeping its image and slot. */
export async function regeneratePost(actor: Actor, businessId: string, id: string) {
  await requireBusiness(actor, businessId, "content.create");
  const item = await requirePost(actor, businessId, id);
  if (!["draft", "pending_approval", "approved", "scheduled", "failed"].includes(item.status)) throw invalid("Only unpublished posts can be regenerated");
  const ctx = await loadBusinessContext(businessId, ["google_posts"]);
  const [asset] = item.mediaAssetId ? await db.select().from(mediaAssets).where(eq(mediaAssets.id, item.mediaAssetId)) : [null];
  const g = item.generation as { keyword?: string; service?: string } | null;
  const gen = await generateGbpPost(ctx, { keyword: g?.keyword, service: g?.service, imageDescription: asset?.description ?? null, holiday: item.holiday, recentPosts: [item.body, ...(await recentBodies(businessId, id))], seed: Date.now() % 1000 });
  await recordAiUsage(ctx.business.orgId, businessId, gen.meta);
  const updated = await editPostBody(item, gen.body);
  await db.update(contentItems).set({ generation: { ...(updated.generation ?? {}), ...gen.meta, angle: gen.angle, editedByPerson: false } }).where(eq(contentItems.id, id));
  return updated;
}

export async function postCalendar(actor: Actor, businessId: string, monthStart: Date, monthEnd: Date) {
  const b = await requireBusiness(actor, businessId);
  const rows = await db
    .select()
    .from(contentItems)
    .where(and(eq(contentItems.businessId, businessId), eq(contentItems.type, "gbp_post"), sql`coalesce(${contentItems.scheduledFor}, ${contentItems.publishedAt}, ${contentItems.createdAt}) between ${monthStart} and ${monthEnd}`));
  return rows.map((r) => {
    const when = r.scheduledFor ?? r.publishedAt ?? r.createdAt;
    const p = toLocalParts(when, b.timezone);
    return { ...r, localDay: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` };
  });
}

/* ---------------- Approval handler ---------------- */

registerTaskHandler("content_item", {
  editable: true,
  async preview(task: TaskRow) {
    const [item] = await db.select().from(contentItems).where(eq(contentItems.id, task.refId)).limit(1);
    if (!item) return { title: task.title, body: "(This post was deleted.)" };
    const meta: Record<string, string> = { Destinations: item.destinations.join(", ") };
    if (item.scheduledFor) meta["Scheduled for"] = item.scheduledFor.toISOString();
    if (item.ctaType) meta.Button = item.ctaType.replace("_", " ").toLowerCase();
    if (item.validation?.issues.length) meta.Checks = item.validation.issues.map((i) => i.message).join("; ");
    return { title: task.title, body: item.body, imageUrl: item.mediaAssetId ? publicMediaUrl(item.mediaAssetId, "web", true) : null, meta };
  },
  async onEdit(task, edits) {
    if (!edits.body) return;
    const [item] = await db.select().from(contentItems).where(eq(contentItems.id, task.refId)).limit(1);
    if (item) await editPostBody(item, edits.body);
  },
  async onApprove(task, ctx) {
    let [item] = await db.select().from(contentItems).where(eq(contentItems.id, task.refId)).limit(1);
    if (!item) return { skipped: "deleted" };
    if (ctx.edits?.body && ctx.edits.body !== item.body) item = await editPostBody(item, ctx.edits.body);
    const errors = item.validation?.issues.filter((i) => i.severity === "error") ?? [];
    // A person approving is the override for warnings; errors (fabricated claims, wrong phone) still block.
    if (errors.length) throw invalid(`This post still has problems to fix before it can publish: ${errors.map((e) => e.message).join("; ")}`);
    await db.update(contentItems).set({ status: "approved", updatedAt: new Date() }).where(eq(contentItems.id, item.id));
    const pubs = await publishContentItem(item.id);
    return { queued: pubs.map((p) => p.destination), scheduledFor: item.scheduledFor?.toISOString() ?? null };
  },
  async onReject(task, ctx) {
    await db.update(contentItems).set({ status: "rejected", generation: sql`coalesce(${contentItems.generation}, '{}'::jsonb) || ${JSON.stringify({ rejectionReason: ctx.reason ?? null })}::jsonb`, updatedAt: new Date() }).where(eq(contentItems.id, task.refId));
  },
  async onSkip(task) {
    await db.update(contentItems).set({ status: "skipped", updatedAt: new Date() }).where(eq(contentItems.id, task.refId));
  },
});
