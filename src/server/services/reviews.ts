import { and, asc, avg, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { automationRules, businessLocations, reviewPolicies, reviewReplies, reviewReports, reviews, reviewTemplates, type ReviewMode } from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { invalid, notFound } from "../errors";
import { loadBusinessContext, type BusinessContext } from "../ai/context";
import { generateReviewReply } from "../ai/tasks";
import { PLATFORM_LIMITS, validateContent } from "@/lib/content-validation";
import { decideReviewAction, renderTemplate, type RatingPolicy } from "@/lib/review-policy";
import { reviewRepliesConfig } from "@/lib/automation-config";
import * as gbp from "../integrations/google/gbp";
import { googleContext } from "./integrations";
import { createTask, registerTaskHandler, type TaskRow } from "./tasks";
import { publishReviewReply } from "./publishing";
import { notifyOrgUsers } from "./notifications";
import { recordAiUsage } from "./usage";

export type Review = typeof reviews.$inferSelect;
export type ReviewReply = typeof reviewReplies.$inferSelect;

/* ---------------- Sync from Google ---------------- */

/** Pulls reviews from Google. Replies made outside the app are recorded as published owner replies. */
export async function syncReviews(businessId: string, maxPages = 10) {
  const g = await googleContext(businessId);
  let pageToken: string | undefined;
  let fetched = 0;
  let created = 0;
  let total: number | undefined;
  let average: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await gbp.listReviews(g.token, g.v4Name, pageToken);
    total = res.totalReviewCount;
    average = res.averageRating;
    for (const r of res.reviews) {
      fetched++;
      const rating = gbp.starToNumber(r.starRating);
      if (!rating) continue;
      const values = {
        businessId,
        source: "google" as const,
        externalId: r.reviewId,
        reviewerName: r.reviewer?.isAnonymous ? null : (r.reviewer?.displayName ?? null),
        rating,
        text: r.comment ?? null,
        publishedAt: new Date(r.createTime),
        ownerReply: r.reviewReply?.comment ?? null,
        ownerReplyAt: r.reviewReply ? new Date(r.reviewReply.updateTime) : null,
        fetchedAt: new Date(),
      };
      const inserted = await db.insert(reviews).values({ ...values, replyStatus: r.reviewReply ? "published" : "unanswered" }).onConflictDoNothing().returning({ id: reviews.id });
      if (inserted[0]) {
        created++;
        continue;
      }
      // Existing review: refresh text/rating and pick up replies posted elsewhere.
      await db
        .update(reviews)
        .set({
          rating: values.rating,
          text: values.text,
          reviewerName: values.reviewerName,
          ownerReply: values.ownerReply,
          ownerReplyAt: values.ownerReplyAt,
          fetchedAt: values.fetchedAt,
          ...(r.reviewReply ? { replyStatus: sql`case when ${reviews.replyStatus} in ('unanswered','failed','pending_approval','escalated','drafting') then 'published' else ${reviews.replyStatus} end` } : {}),
        })
        .where(and(eq(reviews.businessId, businessId), eq(reviews.source, "google"), eq(reviews.externalId, r.reviewId)));
    }
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  await logActivity({ orgId: g.business.orgId, businessId, actor: systemActor, action: "reviews.synced", detail: { fetched, created, total, average } });
  return { fetched, created, totalOnGoogle: total ?? null, averageOnGoogle: average ?? null };
}

/* ---------------- Policies and templates ---------------- */

export async function getPolicies(businessId: string): Promise<RatingPolicy[]> {
  const rows = await db.select().from(reviewPolicies).where(eq(reviewPolicies.businessId, businessId)).orderBy(desc(reviewPolicies.rating));
  return rows.map((r) => ({ rating: r.rating, mode: r.mode, templateId: r.templateId, templateRequiresApproval: r.templateRequiresApproval, escalate: r.escalate }));
}

export const policySchema = z.array(
  z.object({ rating: z.number().int().min(1).max(5), mode: z.enum(["auto", "approval", "template", "ignore"]), templateId: z.string().uuid().nullable().optional(), templateRequiresApproval: z.boolean().optional(), escalate: z.boolean().optional() }),
);

export async function savePolicies(actor: Actor, businessId: string, raw: unknown) {
  await requireBusiness(actor, businessId, "reviews.manage");
  const policies = policySchema.parse(raw);
  const templateIds = policies.map((p) => p.templateId).filter((x): x is string => !!x);
  if (templateIds.length) {
    const found = await db.select({ id: reviewTemplates.id }).from(reviewTemplates).where(and(eq(reviewTemplates.businessId, businessId), inArray(reviewTemplates.id, templateIds)));
    if (found.length !== new Set(templateIds).size) throw invalid("A selected template does not belong to this business");
  }
  for (const p of policies) {
    if (p.mode === "template" && !p.templateId) throw invalid(`Choose a template for ${p.rating}-star reviews`);
    const row = { businessId, rating: p.rating, mode: p.mode as ReviewMode, templateId: p.mode === "template" ? p.templateId! : null, templateRequiresApproval: p.templateRequiresApproval ?? false, escalate: p.escalate ?? false, updatedAt: new Date() };
    await db.insert(reviewPolicies).values(row).onConflictDoUpdate({ target: [reviewPolicies.businessId, reviewPolicies.rating], set: row });
  }
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "review_policies.updated", detail: { policies } });
  return getPolicies(businessId);
}

export async function listTemplates(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(reviewTemplates).where(eq(reviewTemplates.businessId, businessId)).orderBy(asc(reviewTemplates.name));
}

export async function saveTemplate(actor: Actor, businessId: string, input: { id?: string; name: string; body: string }) {
  const b = await requireBusiness(actor, businessId, "reviews.manage");
  const body = input.body.trim();
  if (!input.name.trim() || !body) throw invalid("Templates need a name and a message");
  const sample = renderTemplate(body, { reviewer_first_name: "Alex", business_name: b.name });
  const ctx = await loadBusinessContext(businessId);
  const v = validateContent(sample, { kind: "review_reply", maxLength: PLATFORM_LIMITS.review_reply, facts: ctx.factContext });
  if (!v.ok) throw invalid(`Template problem: ${v.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ")}`);
  if (input.id) {
    const [t] = await db.update(reviewTemplates).set({ name: input.name.trim(), body }).where(and(eq(reviewTemplates.id, input.id), eq(reviewTemplates.businessId, businessId))).returning();
    if (!t) throw notFound("Template");
    return t;
  }
  const [t] = await db.insert(reviewTemplates).values({ businessId, name: input.name.trim(), body }).returning();
  return t;
}

export async function deleteTemplate(actor: Actor, businessId: string, id: string) {
  await requireBusiness(actor, businessId, "reviews.manage");
  const [inUse] = await db.select().from(reviewPolicies).where(and(eq(reviewPolicies.businessId, businessId), eq(reviewPolicies.templateId, id))).limit(1);
  if (inUse) throw invalid(`This template is used for ${inUse.rating}-star reviews; change that rule first`);
  await db.delete(reviewTemplates).where(and(eq(reviewTemplates.id, id), eq(reviewTemplates.businessId, businessId)));
}

/* ---------------- Reply generation and routing ---------------- */

async function recentReplies(businessId: string) {
  const rows = await db.select({ c: reviewReplies.content }).from(reviewReplies).where(and(eq(reviewReplies.businessId, businessId), inArray(reviewReplies.status, ["published", "approved", "pending_approval"]))).orderBy(desc(reviewReplies.createdAt)).limit(8);
  return rows.map((r) => r.c);
}

function validateReply(ctx: BusinessContext, content: string, recent: string[]) {
  return validateContent(content, { kind: "review_reply", maxLength: PLATFORM_LIMITS.review_reply, facts: ctx.factContext, recentContent: recent, duplicateThreshold: 0.8 });
}

type ProcessResult = { reviewId: string; action: string; detail?: string };

/**
 * Applies the per-star policy to one review: ignore, template or AI reply,
 * then auto-publish or route for approval. Validation failures always route
 * to a person.
 */
export async function processReview(review: Review, ctx: BusinessContext, policies: RatingPolicy[], opts: { signOff?: string; recipients: string[]; showInDashboard: boolean }): Promise<ProcessResult> {
  const decision = decideReviewAction(review, policies);
  if (decision.action === "skip") return { reviewId: review.id, action: "skipped", detail: decision.reason };
  if (decision.action === "ignore") {
    await db.update(reviews).set({ replyStatus: "ignored", policyApplied: "ignore" }).where(eq(reviews.id, review.id));
    return { reviewId: review.id, action: "ignored" };
  }
  // Claim the review so overlapping runs cannot draft two replies.
  const [claimed] = await db.update(reviews).set({ replyStatus: "drafting" }).where(and(eq(reviews.id, review.id), inArray(reviews.replyStatus, ["unanswered", "failed"]))).returning();
  if (!claimed) return { reviewId: review.id, action: "skipped", detail: "Already being handled" };

  try {
    let content: string;
    let origin: ReviewReply["origin"];
    let generation: Record<string, unknown> = {};
    if (decision.action === "template") {
      const [tpl] = await db.select().from(reviewTemplates).where(and(eq(reviewTemplates.id, decision.templateId), eq(reviewTemplates.businessId, review.businessId))).limit(1);
      if (!tpl) throw invalid("The selected template no longer exists");
      content = renderTemplate(tpl.body, { reviewer_first_name: review.reviewerName?.split(/\s+/)[0], business_name: ctx.business.name });
      origin = "template";
      generation = { templateId: tpl.id };
    } else {
      const { data, meta } = await generateReviewReply(ctx, review, { signOff: opts.signOff, recentReplies: await recentReplies(review.businessId) });
      await recordAiUsage(ctx.business.orgId, review.businessId, meta);
      content = data.reply.trim();
      origin = "ai";
      generation = { ...meta };
      await db.update(reviews).set({ sentiment: data.sentiment, analysis: { praise: data.praise, complaints: data.complaints, requestedResolution: data.requestedResolution } }).where(eq(reviews.id, review.id));
    }
    const validation = validateReply(ctx, content, await recentReplies(review.businessId));
    const autoPublish = decision.publish === "auto" && validation.ok && review.source !== "demo";
    const demoAuto = decision.publish === "auto" && validation.ok && review.source === "demo";
    const [reply] = await db
      .insert(reviewReplies)
      .values({ reviewId: review.id, businessId: review.businessId, content, origin, status: autoPublish || demoAuto ? "approved" : "pending_approval", validation, generation })
      .returning();
    const policyLabel = `${review.rating}-star: ${decision.action === "template" ? "template" : decision.publish}`;
    if (autoPublish || demoAuto) {
      await db.update(reviews).set({ replyStatus: "approved", policyApplied: policyLabel }).where(eq(reviews.id, review.id));
      await publishReviewReply(reply.id);
      return { reviewId: review.id, action: "auto_published" };
    }
    const escalated = decision.escalate;
    await db.update(reviews).set({ replyStatus: escalated ? "escalated" : "pending_approval", policyApplied: policyLabel }).where(eq(reviews.id, review.id));
    const task = await createTask({
      orgId: ctx.business.orgId,
      businessId: review.businessId,
      type: "review_reply",
      title: `${escalated ? "Escalated: " : ""}Reply to ${review.reviewerName ?? "a customer"}'s ${review.rating}-star review`,
      summary: validation.ok ? (escalated ? "Low rating; review before replying" : "Reply ready for approval") : `Needs review: ${validation.issues.find((i) => i.severity === "error")?.message}`,
      refType: "review_reply",
      refId: reply.id,
      dueAt: new Date(Date.now() + 3 * 86400_000),
      notificationRecipients: opts.recipients,
      visibleInDashboard: opts.showInDashboard,
    });
    await db.update(reviewReplies).set({ taskId: task.id }).where(eq(reviewReplies.id, reply.id));
    if (escalated) {
      await notifyOrgUsers(ctx.business.orgId, review.businessId, { type: "review.escalated", title: `${review.rating}-star review needs attention`, body: (review.text ?? "(no text)").slice(0, 200), link: `/b/${review.businessId}/reviews?focus=${review.id}` });
    }
    return { reviewId: review.id, action: escalated ? "escalated" : "awaiting_approval" };
  } catch (e) {
    await db.update(reviews).set({ replyStatus: "failed" }).where(eq(reviews.id, review.id));
    throw e;
  }
}

/** Handles new reviews (or older ones for the historical automation) in rating order: worst first. */
export async function processReviews(businessId: string, opts: { mode: "new" | "historical"; limit?: number }) {
  const [rule] = await db.select().from(automationRules).where(and(eq(automationRules.businessId, businessId), eq(automationRules.type, opts.mode === "new" ? "review_replies" : "historical_reviews"))).limit(1);
  const cfg = reviewRepliesConfig.parse(rule?.config ?? {});
  const policies = await getPolicies(businessId);
  const ctx = await loadBusinessContext(businessId, ["review_replies"]);
  const conds: SQL[] = [eq(reviews.businessId, businessId), inArray(reviews.replyStatus, ["unanswered", "failed"]), isNull(reviews.ownerReply)];
  const lookback = new Date(Date.now() - cfg.historicalLookbackDays * 86400_000);
  // "new" = arrived since the rule was enabled (or the last 7 days); "historical" = the rest of the lookback window.
  const newSince = rule?.lastSuccessAt ? new Date(rule.lastSuccessAt.getTime() - 7 * 86400_000) : new Date(Date.now() - 7 * 86400_000);
  if (opts.mode === "new") conds.push(gte(reviews.publishedAt, newSince));
  else conds.push(gte(reviews.publishedAt, lookback), lte(reviews.publishedAt, newSince));
  const due = await db.select().from(reviews).where(and(...conds)).orderBy(asc(reviews.rating), desc(reviews.publishedAt)).limit(opts.limit ?? (opts.mode === "new" ? 25 : cfg.historicalPerRun));
  const results: ProcessResult[] = [];
  for (const r of due) {
    try {
      results.push(await processReview(r, ctx, policies, { signOff: cfg.signOff, recipients: rule?.notificationRecipients ?? [], showInDashboard: rule?.showTasksInDashboard ?? true }));
    } catch (e) {
      results.push({ reviewId: r.id, action: "failed", detail: (e as Error).message });
    }
  }
  const tally = results.reduce<Record<string, number>>((acc, r) => ((acc[r.action] = (acc[r.action] ?? 0) + 1), acc), {});
  return { processed: results.length, tally, results };
}

/* ---------------- Manual actions ---------------- */

async function requireReview(actor: Actor, businessId: string, reviewId: string, permission: "business.view" | "reviews.reply" = "business.view") {
  await requireBusiness(actor, businessId, permission);
  const [r] = await db.select().from(reviews).where(and(eq(reviews.id, reviewId), eq(reviews.businessId, businessId))).limit(1);
  if (!r) throw notFound("Review");
  return r;
}

export async function draftReplyForReview(actor: Actor, businessId: string, reviewId: string) {
  const r = await requireReview(actor, businessId, reviewId, "reviews.reply");
  const ctx = await loadBusinessContext(businessId, ["review_replies"]);
  const { data, meta } = await generateReviewReply(ctx, r, { recentReplies: await recentReplies(businessId) });
  await recordAiUsage(actor.orgId, businessId, meta);
  const validation = validateReply(ctx, data.reply, await recentReplies(businessId));
  return { content: data.reply, validation, demo: meta.isDemo, analysis: { sentiment: data.sentiment, praise: data.praise, complaints: data.complaints } };
}

/** Generates an AI draft and stores it as an unpublished draft the person can edit and submit. */
export async function saveAiDraft(actor: Actor, businessId: string, reviewId: string) {
  const d = await draftReplyForReview(actor, businessId, reviewId);
  await db.update(reviewReplies).set({ status: "superseded" }).where(and(eq(reviewReplies.reviewId, reviewId), eq(reviewReplies.status, "draft")));
  const [row] = await db.insert(reviewReplies).values({ reviewId, businessId, content: d.content, origin: "ai", status: "draft", validation: d.validation, generation: { demo: d.demo }, createdByUserId: actor.userId }).returning();
  return row;
}

/** A person writes or edits a reply and publishes it. Validation errors block publishing. */
export async function submitManualReply(actor: Actor, businessId: string, reviewId: string, content: string) {
  const r = await requireReview(actor, businessId, reviewId, "reviews.reply");
  if (r.ownerReply && r.replyStatus === "published") throw invalid("This review already has a reply. Edit it on Google, or sync to refresh.");
  const ctx = await loadBusinessContext(businessId);
  const validation = validateReply(ctx, content, []);
  if (!validation.ok) throw invalid(validation.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "));
  await db.update(reviewReplies).set({ status: "superseded" }).where(and(eq(reviewReplies.reviewId, r.id), inArray(reviewReplies.status, ["draft", "pending_approval", "failed"])));
  const { completeTaskForRef } = await import("./tasks");
  const open = await db.select({ id: reviewReplies.id }).from(reviewReplies).where(eq(reviewReplies.reviewId, r.id));
  for (const o of open) await completeTaskForRef("review_reply", o.id, { supersededByManualReply: true }, "cancelled");
  const [reply] = await db.insert(reviewReplies).values({ reviewId: r.id, businessId, content: content.trim(), origin: "manual", status: "approved", validation, createdByUserId: actor.userId }).returning();
  await db.update(reviews).set({ replyStatus: "approved", policyApplied: "manual" }).where(eq(reviews.id, r.id));
  await publishReviewReply(reply.id);
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "review_reply.submitted", target: { type: "review", id: r.id } });
  return reply;
}

export async function ignoreReview(actor: Actor, businessId: string, reviewId: string) {
  const r = await requireReview(actor, businessId, reviewId, "reviews.reply");
  await db.update(reviews).set({ replyStatus: "ignored", policyApplied: "manual ignore" }).where(eq(reviews.id, r.id));
  const pending = await db.select({ id: reviewReplies.id }).from(reviewReplies).where(and(eq(reviewReplies.reviewId, r.id), eq(reviewReplies.status, "pending_approval")));
  const { completeTaskForRef } = await import("./tasks");
  for (const p of pending) {
    await db.update(reviewReplies).set({ status: "superseded" }).where(eq(reviewReplies.id, p.id));
    await completeTaskForRef("review_reply", p.id, { ignored: true }, "cancelled");
  }
}

export async function requeueReview(actor: Actor, businessId: string, reviewId: string) {
  const r = await requireReview(actor, businessId, reviewId, "reviews.reply");
  if (r.ownerReply) throw invalid("This review already has a reply");
  await db.update(reviews).set({ replyStatus: "unanswered", policyApplied: null }).where(eq(reviews.id, r.id));
}

export type ReviewFilters = { rating?: number; status?: string; q?: string; from?: Date; to?: Date };

export async function listReviews(actor: Actor, businessId: string, f: ReviewFilters = {}, limit = 100, offset = 0) {
  await requireBusiness(actor, businessId);
  const conds: SQL[] = [eq(reviews.businessId, businessId)];
  if (f.rating) conds.push(eq(reviews.rating, f.rating));
  if (f.status && f.status !== "all") conds.push(f.status === "needs_action" ? inArray(reviews.replyStatus, ["pending_approval", "escalated", "failed"]) : eq(reviews.replyStatus, f.status as Review["replyStatus"]));
  if (f.q) conds.push(or(ilike(reviews.text, `%${f.q}%`), ilike(reviews.reviewerName, `%${f.q}%`))!);
  if (f.from) conds.push(gte(reviews.publishedAt, f.from));
  if (f.to) conds.push(lte(reviews.publishedAt, f.to));
  const rows = await db.select().from(reviews).where(and(...conds)).orderBy(desc(reviews.publishedAt)).limit(limit).offset(offset);
  const replies = rows.length ? await db.select().from(reviewReplies).where(and(inArray(reviewReplies.reviewId, rows.map((r) => r.id)), sql`${reviewReplies.status} <> 'superseded'`)).orderBy(desc(reviewReplies.createdAt)) : [];
  return rows.map((r) => ({ ...r, latestReply: replies.find((x) => x.reviewId === r.id) ?? null }));
}

/** Aggregates over reviews stored locally; labeled as such since Google may hold more. */
export async function reviewStats(businessId: string, since?: Date) {
  const conds: SQL[] = [eq(reviews.businessId, businessId)];
  if (since) conds.push(gte(reviews.publishedAt, since));
  const [agg] = await db.select({ total: count(), average: avg(reviews.rating), demo: sql<number>`count(*) filter (where ${reviews.isDemo})::int` }).from(reviews).where(and(...conds));
  const byRating = await db.select({ rating: reviews.rating, n: count() }).from(reviews).where(and(...conds)).groupBy(reviews.rating);
  const byStatus = await db.select({ status: reviews.replyStatus, n: count() }).from(reviews).where(and(...conds)).groupBy(reviews.replyStatus);
  const replied = byStatus.filter((s) => s.status === "published").reduce((a, s) => a + s.n, 0);
  return {
    total: agg.total,
    average: agg.average ? Number(Number(agg.average).toFixed(2)) : null,
    demoCount: agg.demo,
    byRating: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, byRating.find((r) => r.rating === n)?.n ?? 0])),
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
    responseRate: agg.total ? replied / agg.total : null,
  };
}

/* ---------------- Removal requests ---------------- */

/**
 * Policy signals that may justify asking Google to remove a review. These are
 * heuristics for a person to evaluate, not determinations. Google has no
 * public API to submit removal requests, so submission is recorded manually.
 */
export function detectPolicySignals(r: Pick<Review, "text" | "rating">, businessName: string): string[] {
  const t = (r.text ?? "").toLowerCase();
  const signals: string[] = [];
  if (!t.trim()) signals.push("Rating only, no text to evaluate");
  if (/\b(fuck|shit|bitch|asshole|bastard)\b/.test(t)) signals.push("Profanity");
  if (/https?:\/\/|www\./.test(t)) signals.push("Contains a link (possible spam)");
  if (/\b(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\b/.test(t) || /[^\s@]+@[^\s@]+\.[a-z]{2,}/.test(t)) signals.push("Contains personal contact information");
  if (/\b(never (been|went|visited)|wasn'?t a customer|haven'?t used)\b/.test(t)) signals.push("Reviewer may not have been a customer");
  if (/\b(i work(ed)? (for|at)|former employee|ex-employee)\b/.test(t)) signals.push("Possible conflict of interest (employee)");
  if (/\b(go to|use|try) [a-z]+ instead\b/.test(t)) signals.push("Promotes another business");
  if (t && !t.includes(businessName.toLowerCase().split(/\s+/)[0]) && /\b(wrong (business|company|place)|meant to review)\b/.test(t)) signals.push("May be about a different business");
  return signals;
}

export async function createRemovalRequest(actor: Actor, businessId: string, reviewId: string, input: { reason: string; evidence?: string }) {
  const r = await requireReview(actor, businessId, reviewId, "reviews.reply");
  const b = await requireBusiness(actor, businessId);
  const [rep] = await db.insert(reviewReports).values({ reviewId: r.id, businessId, reason: input.reason, evidence: input.evidence ?? null, detectedSignals: detectPolicySignals(r, b.name) }).returning();
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "review_report.created", target: { type: "review_report", id: rep.id } });
  return rep;
}

export async function updateRemovalRequest(actor: Actor, businessId: string, reportId: string, patch: { status: "submitted" | "removed" | "kept" | "unknown"; notes?: string; submissionMethod?: string }) {
  await requireBusiness(actor, businessId, "reviews.reply");
  const set: Partial<typeof reviewReports.$inferInsert> = { status: patch.status, notes: patch.notes ?? null };
  if (patch.status === "submitted") Object.assign(set, { submittedAt: new Date(), submittedByUserId: actor.userId, submissionMethod: patch.submissionMethod ?? "Google reviews management tool" });
  if (["removed", "kept"].includes(patch.status)) set.outcomeAt = new Date();
  const [rep] = await db.update(reviewReports).set(set).where(and(eq(reviewReports.id, reportId), eq(reviewReports.businessId, businessId))).returning();
  if (!rep) throw notFound("Removal request");
  return rep;
}

export async function listRemovalRequests(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select({ report: reviewReports, review: reviews }).from(reviewReports).innerJoin(reviews, eq(reviews.id, reviewReports.reviewId)).where(eq(reviewReports.businessId, businessId)).orderBy(desc(reviewReports.createdAt));
}

/* ---------------- Approval handler ---------------- */

async function editReply(replyId: string, body: string) {
  const [reply] = await db.select().from(reviewReplies).where(eq(reviewReplies.id, replyId)).limit(1);
  if (!reply) return null;
  const ctx = await loadBusinessContext(reply.businessId);
  const validation = validateReply(ctx, body, []);
  const [u] = await db.update(reviewReplies).set({ content: body.trim(), validation, origin: reply.origin === "manual" ? "manual" : reply.origin, generation: { ...(reply.generation ?? {}), editedByPerson: true }, updatedAt: new Date() }).where(eq(reviewReplies.id, replyId)).returning();
  return u;
}

registerTaskHandler("review_reply", {
  editable: true,
  async preview(task: TaskRow) {
    const [row] = await db.select({ reply: reviewReplies, review: reviews }).from(reviewReplies).innerJoin(reviews, eq(reviews.id, reviewReplies.reviewId)).where(eq(reviewReplies.id, task.refId)).limit(1);
    if (!row) return { title: task.title, body: "(This reply was deleted.)" };
    return {
      title: task.title,
      body: row.reply.content,
      meta: {
        Review: `${"★".repeat(row.review.rating)}${"☆".repeat(5 - row.review.rating)} ${row.review.reviewerName ?? "Customer"}: ${row.review.text ?? "(no text)"}`,
        ...(row.review.isDemo ? { Note: "Demo review. Approving will not post anything to Google." } : {}),
        ...(row.reply.validation?.issues.length ? { Checks: row.reply.validation.issues.map((i) => i.message).join("; ") } : {}),
      },
    };
  },
  async onEdit(task, edits) {
    if (edits.body) await editReply(task.refId, edits.body);
  },
  async onApprove(task, ctx) {
    let [reply] = await db.select().from(reviewReplies).where(eq(reviewReplies.id, task.refId)).limit(1);
    if (!reply) return { skipped: "deleted" };
    if (ctx.edits?.body && ctx.edits.body !== reply.content) reply = (await editReply(reply.id, ctx.edits.body))!;
    const errors = reply.validation?.issues.filter((i) => i.severity === "error") ?? [];
    if (errors.length) throw invalid(`Fix before publishing: ${errors.map((e) => e.message).join("; ")}`);
    const [review] = await db.select().from(reviews).where(eq(reviews.id, reply.reviewId)).limit(1);
    if (review?.ownerReply) {
      await db.update(reviewReplies).set({ status: "superseded" }).where(eq(reviewReplies.id, reply.id));
      return { skipped: "The review was answered elsewhere in the meantime" };
    }
    await db.update(reviewReplies).set({ status: "approved", updatedAt: new Date() }).where(eq(reviewReplies.id, reply.id));
    await db.update(reviews).set({ replyStatus: "approved" }).where(eq(reviews.id, reply.reviewId));
    const pub = await publishReviewReply(reply.id);
    return { publicationId: pub.id };
  },
  async onReject(task) {
    const [reply] = await db.update(reviewReplies).set({ status: "rejected", updatedAt: new Date() }).where(eq(reviewReplies.id, task.refId)).returning();
    // The review is parked so automations do not re-draft it; a person can reply manually or re-queue it.
    if (reply) await db.update(reviews).set({ replyStatus: "ignored", policyApplied: "draft rejected; reply manually or re-queue" }).where(eq(reviews.id, reply.reviewId));
  },
  async onSkip(task) {
    const [reply] = await db.update(reviewReplies).set({ status: "superseded", updatedAt: new Date() }).where(eq(reviewReplies.id, task.refId)).returning();
    if (reply) await db.update(reviews).set({ replyStatus: "ignored", policyApplied: "skipped" }).where(eq(reviews.id, reply.reviewId));
  },
});

export async function businessForReview(reviewId: string) {
  const [r] = await db.select({ b: businessLocations }).from(reviews).innerJoin(businessLocations, eq(businessLocations.id, reviews.businessId)).where(eq(reviews.id, reviewId)).limit(1);
  return r?.b ?? null;
}
