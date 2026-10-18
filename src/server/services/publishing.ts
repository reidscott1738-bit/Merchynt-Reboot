import { and, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import {
  businessLocations,
  contentItems,
  integrations,
  integrationTargets,
  mediaAssets,
  publicationJobs,
  reviewReplies,
  reviews,
  type ContentStatus,
} from "../db/schema";
import { enqueue } from "../jobs/queue";
import { env } from "../env";
import { AppError, notFound } from "../errors";
import { getAccessToken } from "../integrations/oauth";
import * as gbp from "../integrations/google/gbp";
import * as meta from "../integrations/social/meta";
import * as linkedin from "../integrations/social/linkedin";
import { publicMediaUrl, storage } from "../storage";
import { logActivity, systemActor } from "../activity";
import { notifyOrgUsers } from "./notifications";
import { recordTaskOutcome } from "./tasks";
import { recordUsage } from "./usage";

/**
 * Publication engine. Every outbound publish is a publication_jobs row with a
 * unique idempotency key, executed by the worker through the durable queue.
 * A row is only marked succeeded when the provider returned an id; demo-mode
 * rows are flagged is_demo and never claim a provider id or URL.
 */

export type PublicationRow = typeof publicationJobs.$inferSelect;
type Destination = PublicationRow["destination"];

const TARGET_FOR: Record<Exclude<Destination, "website" | "youtube" | "google">, (typeof integrationTargets.$inferSelect)["targetType"]> = {
  facebook: "facebook_page",
  instagram: "instagram_account",
  linkedin: "linkedin_organization",
};

export async function queuePublication(
  input: { businessId: string; orgId: string; kind: PublicationRow["kind"]; refType: string; refId: string; destination: Destination; requestedFor?: Date; idempotencyKey: string; targetId?: string | null },
  tx: DbOrTx = db,
) {
  const requestedFor = input.requestedFor ?? new Date();
  const inserted = await tx
    .insert(publicationJobs)
    .values({ businessId: input.businessId, kind: input.kind, refType: input.refType, refId: input.refId, destination: input.destination, targetId: input.targetId ?? null, requestedFor, idempotencyKey: input.idempotencyKey })
    .onConflictDoNothing({ target: publicationJobs.idempotencyKey })
    .returning();
  const row = inserted[0] ?? (await tx.select().from(publicationJobs).where(eq(publicationJobs.idempotencyKey, input.idempotencyKey)).limit(1))[0];
  if (inserted[0]) {
    await enqueue("publish.run", { publicationId: row.id }, { idempotencyKey: `publish:${row.id}`, runAt: requestedFor, maxAttempts: 5, backoffBaseMs: 60_000, orgId: input.orgId, businessId: input.businessId }, tx);
  }
  return row;
}

/** Queues one publication per destination for an approved content item. */
export async function publishContentItem(contentId: string, tx: DbOrTx = db) {
  const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, contentId)).limit(1);
  if (!item) throw notFound("Content");
  if (!["approved", "scheduled", "failed", "partially_published"].includes(item.status)) return [];
  const [b] = await tx.select().from(businessLocations).where(eq(businessLocations.id, item.businessId)).limit(1);
  const when = item.scheduledFor && item.scheduledFor > new Date() ? item.scheduledFor : new Date();
  const out: PublicationRow[] = [];
  for (const dest of item.destinations as Destination[]) {
    out.push(
      await queuePublication(
        { businessId: item.businessId, orgId: b.orgId, kind: dest === "google" ? "gbp_post" : "social_post", refType: "content_item", refId: item.id, destination: dest, requestedFor: when, idempotencyKey: `content:${item.id}:${dest}:${item.contentHash.slice(0, 16)}` },
        tx,
      ),
    );
  }
  await tx.update(contentItems).set({ status: when > new Date() ? "scheduled" : "publishing", updatedAt: new Date() }).where(eq(contentItems.id, item.id));
  return out;
}

export async function publishReviewReply(replyId: string, tx: DbOrTx = db) {
  const [r] = await tx.select().from(reviewReplies).where(eq(reviewReplies.id, replyId)).limit(1);
  if (!r) throw notFound("Reply");
  const [b] = await tx.select().from(businessLocations).where(eq(businessLocations.id, r.businessId)).limit(1);
  const pub = await queuePublication({ businessId: r.businessId, orgId: b.orgId, kind: "review_reply", refType: "review_reply", refId: r.id, destination: "google", idempotencyKey: `reply:${r.id}` }, tx);
  await tx.update(reviewReplies).set({ status: "publishing", publicationJobId: pub.id, updatedAt: new Date() }).where(eq(reviewReplies.id, r.id));
  await tx.update(reviews).set({ replyStatus: "publishing" }).where(eq(reviews.id, r.reviewId));
  return pub;
}

type Outcome = { providerId: string | null; providerUrl?: string | null; response?: Record<string, unknown>; isDemo: boolean };

class BlockedError extends AppError {
  constructor(message: string) {
    super(message, "not_configured");
  }
}

async function googleFor(businessId: string) {
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  if (!b?.gbpLocationName || !b.gbpAccountName || !b.googleIntegrationId) return null;
  const [integ] = await db.select().from(integrations).where(eq(integrations.id, b.googleIntegrationId)).limit(1);
  if (!integ || integ.status === "revoked") return null;
  return { b, integ, v4: gbp.v4Location(b.gbpAccountName, b.gbpLocationName) };
}

async function socialTarget(businessId: string, dest: keyof typeof TARGET_FOR) {
  const [row] = await db
    .select({ t: integrationTargets, i: integrations })
    .from(integrationTargets)
    .innerJoin(integrations, eq(integrations.id, integrationTargets.integrationId))
    .where(and(eq(integrationTargets.businessId, businessId), eq(integrationTargets.targetType, TARGET_FOR[dest]), eq(integrationTargets.enabled, true)))
    .limit(1);
  return row && row.i.status !== "revoked" ? row : null;
}

function demoAllowed() {
  return env().DEMO_MODE;
}

function demoOutcome(what: string): Outcome {
  return { providerId: null, providerUrl: null, isDemo: true, response: { demo: true, note: `Demo mode: ${what} was not sent to any external service.` } };
}

/** Public URL for media that external providers fetch. Providers cannot reach localhost. */
function externalMediaUrl(assetId: string) {
  const url = publicMediaUrl(assetId, "web", true);
  if (/\/\/(localhost|127\.0\.0\.1)/.test(url)) {
    throw new BlockedError("APP_URL points to localhost, so Google and social networks cannot fetch the image. Set APP_URL to a public HTTPS address.");
  }
  return url;
}

const CTA_NEEDS_URL = new Set(["LEARN_MORE", "BOOK", "ORDER", "SHOP", "SIGN_UP"]);

async function runContent(pub: PublicationRow): Promise<Outcome> {
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, pub.refId)).limit(1);
  if (!item) throw new BlockedError("Content was deleted");
  const [asset] = item.mediaAssetId ? await db.select().from(mediaAssets).where(eq(mediaAssets.id, item.mediaAssetId)).limit(1) : [null];

  if (pub.destination === "google") {
    const g = await googleFor(pub.businessId);
    if (!g) {
      if (demoAllowed()) return demoOutcome("this Google post");
      throw new BlockedError("Google Business Profile is not connected for this business");
    }
    const token = await getAccessToken(g.integ);
    const cta = item.ctaType && item.ctaType !== "NONE" ? { actionType: item.ctaType, url: CTA_NEEDS_URL.has(item.ctaType) ? (item.ctaUrl ?? g.b.website ?? undefined) : undefined } : undefined;
    if (cta && CTA_NEEDS_URL.has(cta.actionType) && !cta.url) throw new BlockedError(`The ${cta.actionType} button needs a URL, and the business has no website on file`);
    const res = await gbp.createLocalPost(token, g.v4, {
      summary: item.body,
      callToAction: cta,
      media: asset ? [{ mediaFormat: "PHOTO", sourceUrl: externalMediaUrl(asset.id) }] : undefined,
    });
    if (!res.name) throw new AppError("Google did not return a post id", "external");
    return { providerId: res.name, providerUrl: res.searchUrl ?? null, response: { state: res.state ?? null }, isDemo: false };
  }

  if (pub.destination === "facebook" || pub.destination === "instagram" || pub.destination === "linkedin") {
    const target = await socialTarget(pub.businessId, pub.destination);
    if (!target) {
      if (demoAllowed()) return demoOutcome(`this ${pub.destination} post`);
      throw new BlockedError(`No ${pub.destination} account is linked to this business`);
    }
    const token = await getAccessToken(target.i);
    if (pub.destination === "facebook") {
      const pageToken = await meta.getPageToken(token, target.t.externalId);
      const res = await meta.publishFacebookPost(pageToken, target.t.externalId, { message: item.body, imageUrl: asset ? externalMediaUrl(asset.id) : null, link: asset ? null : item.ctaUrl });
      return { providerId: res.providerId, providerUrl: res.url, isDemo: false };
    }
    if (pub.destination === "instagram") {
      if (!asset) throw new BlockedError("Instagram posts require an image");
      const pages = await meta.listPages(token);
      const page = pages.find((p) => p.instagram_business_account?.id === target.t.externalId);
      if (!page) throw new BlockedError("The Instagram account is no longer linked to a Facebook Page you manage");
      const res = await meta.publishInstagram(page.access_token, target.t.externalId, { caption: item.body, imageUrl: externalMediaUrl(asset.id) });
      return { providerId: res.providerId, providerUrl: res.url, isDemo: false };
    }
    const img = asset ? { data: await storage().get(asset.storageKey), contentType: asset.mime, alt: asset.altText ?? undefined } : null;
    const res = await linkedin.publishLinkedInPost(token, target.t.externalId, { text: item.body, image: img });
    if (!res.providerId) throw new AppError("LinkedIn accepted the request but returned no post id", "external");
    return { providerId: res.providerId, providerUrl: res.url, isDemo: false };
  }
  throw new BlockedError(`Publishing content to ${pub.destination} is not supported`);
}

async function runReviewReply(pub: PublicationRow): Promise<Outcome> {
  const [reply] = await db.select().from(reviewReplies).where(eq(reviewReplies.id, pub.refId)).limit(1);
  if (!reply) throw new BlockedError("Reply was deleted");
  const [review] = await db.select().from(reviews).where(eq(reviews.id, reply.reviewId)).limit(1);
  if (review.source === "demo") {
    if (!demoAllowed()) throw new BlockedError("Demo reviews cannot be replied to outside demo mode");
    return demoOutcome("this review reply");
  }
  const g = await googleFor(pub.businessId);
  if (!g) throw new BlockedError("Google Business Profile is not connected for this business");
  const token = await getAccessToken(g.integ);
  const res = await gbp.replyToReview(token, `${g.v4}/reviews/${review.externalId}`, reply.content);
  return { providerId: `${g.v4}/reviews/${review.externalId}/reply`, response: { updateTime: res.updateTime }, isDemo: false };
}

const RUNNERS: Partial<Record<PublicationRow["kind"], (p: PublicationRow) => Promise<Outcome>>> = {
  gbp_post: runContent,
  social_post: runContent,
  review_reply: runReviewReply,
};

/** Registers an extra runner (videos and website publishes live in their own modules). */
export function registerPublicationRunner(kind: PublicationRow["kind"], fn: (p: PublicationRow) => Promise<Outcome>) {
  RUNNERS[kind] = fn;
}

/** Worker entry point for the "publish.run" job. Throws to let the queue retry transient failures. */
export async function runPublication(publicationId: string, attempt: number, isFinalAttempt: boolean) {
  const [pub] = await db.select().from(publicationJobs).where(eq(publicationJobs.id, publicationId)).limit(1);
  if (!pub) return { skipped: "missing" };
  if (pub.status === "succeeded" || pub.status === "cancelled") return { skipped: pub.status };
  await db.update(publicationJobs).set({ status: "in_progress", attempts: attempt, lastAttemptAt: new Date() }).where(eq(publicationJobs.id, pub.id));
  const runner = RUNNERS[pub.kind];
  try {
    if (!runner) throw new BlockedError(`No publisher for ${pub.kind}`);
    const out = await runner(pub);
    await db
      .update(publicationJobs)
      .set({ status: "succeeded", completedAt: new Date(), providerId: out.providerId, providerUrl: out.providerUrl ?? null, providerResponse: out.response ?? null, isDemo: out.isDemo, lastError: null })
      .where(eq(publicationJobs.id, pub.id));
    if (!out.isDemo) await recordUsage((await orgOf(pub.businessId)) ?? "", pub.businessId, "publication", 1, pub.destination);
    await afterPublication({ ...pub, status: "succeeded", isDemo: out.isDemo, providerUrl: out.providerUrl ?? null, providerId: out.providerId });
    return { ok: true, demo: out.isDemo };
  } catch (e) {
    const err = e as Error;
    const blocked = e instanceof BlockedError || (e instanceof AppError && e.code !== "rate_limited");
    const terminal = blocked || isFinalAttempt;
    await db.update(publicationJobs).set({ status: terminal ? (blocked ? "blocked" : "failed") : "queued", lastError: err.message }).where(eq(publicationJobs.id, pub.id));
    if (terminal) await afterPublication({ ...pub, status: blocked ? "blocked" : "failed", lastError: err.message });
    if (blocked) return { blocked: err.message };
    throw e;
  }
}

async function orgOf(businessId: string) {
  const [b] = await db.select({ orgId: businessLocations.orgId }).from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  return b?.orgId ?? null;
}

/** Rolls publication outcomes up into the content item / review status. */
async function afterPublication(pub: PublicationRow) {
  const orgId = (await orgOf(pub.businessId))!;
  if (pub.refType === "content_item") {
    const all = await db.select().from(publicationJobs).where(and(eq(publicationJobs.refType, "content_item"), eq(publicationJobs.refId, pub.refId)));
    const done = all.filter((p) => ["succeeded", "failed", "blocked", "cancelled"].includes(p.status));
    if (done.length < all.length) return;
    const ok = all.filter((p) => p.status === "succeeded");
    const status: ContentStatus = ok.length === all.length ? "published" : ok.length ? "partially_published" : "failed";
    await db.update(contentItems).set({ status, publishedAt: ok.length ? new Date() : null, updatedAt: new Date() }).where(eq(contentItems.id, pub.refId));
    const outcome = {
      status,
      destinations: all.map((p) => ({ destination: p.destination, status: p.status, url: p.providerUrl, demo: p.isDemo, error: p.lastError })),
    };
    await recordTaskOutcome("content_item", pub.refId, outcome);
    if (status !== "published") {
      await notifyOrgUsers(orgId, pub.businessId, {
        type: "publish.failed",
        title: status === "failed" ? "A post failed to publish" : "A post published to some destinations only",
        body: all.filter((p) => p.status !== "succeeded").map((p) => `${p.destination}: ${p.lastError ?? p.status}`).join("; "),
        link: `/b/${pub.businessId}/posts?tab=all`,
      });
    }
    await logActivity({ orgId, businessId: pub.businessId, actor: systemActor, action: `content.${status}`, target: { type: "content_item", id: pub.refId }, detail: outcome });
  } else if (pub.refType === "video_project") {
    const { settleVideoStatus } = await import("./videos");
    await settleVideoStatus(pub.refId);
    await recordTaskOutcome("video_project", pub.refId, { destination: pub.destination, status: pub.status, url: pub.providerUrl, demo: pub.isDemo, error: pub.lastError });
  } else if (pub.refType === "review_reply") {
    const [reply] = await db.select().from(reviewReplies).where(eq(reviewReplies.id, pub.refId)).limit(1);
    if (!reply) return;
    if (pub.status === "succeeded") {
      await db.update(reviewReplies).set({ status: "published", publishedAt: new Date(), updatedAt: new Date() }).where(eq(reviewReplies.id, reply.id));
      await db.update(reviews).set({ replyStatus: "published", ownerReply: reply.content, ownerReplyAt: new Date() }).where(eq(reviews.id, reply.reviewId));
    } else {
      await db.update(reviewReplies).set({ status: "failed", updatedAt: new Date() }).where(eq(reviewReplies.id, reply.id));
      await db.update(reviews).set({ replyStatus: "failed" }).where(eq(reviews.id, reply.reviewId));
      await notifyOrgUsers(orgId, pub.businessId, { type: "publish.failed", title: "A review reply failed to publish", body: pub.lastError ?? undefined, link: `/b/${pub.businessId}/reviews` });
    }
    await recordTaskOutcome("review_reply", reply.id, { status: pub.status, demo: pub.isDemo, error: pub.lastError });
    await logActivity({ orgId, businessId: pub.businessId, actor: systemActor, action: `review_reply.${pub.status}`, target: { type: "review_reply", id: reply.id }, detail: { demo: pub.isDemo, error: pub.lastError } });
  }
}

export async function listPublications(businessId: string, refType?: string, refIds?: string[]) {
  const conds = [eq(publicationJobs.businessId, businessId)];
  if (refType) conds.push(eq(publicationJobs.refType, refType));
  if (refIds?.length) conds.push(inArray(publicationJobs.refId, refIds));
  return db.select().from(publicationJobs).where(and(...conds));
}

/** Re-queues failed or blocked publications for a ref (after reconnecting an account, for example). */
export async function retryPublications(businessId: string, refType: string, refId: string) {
  const rows = await db.select().from(publicationJobs).where(and(eq(publicationJobs.businessId, businessId), eq(publicationJobs.refType, refType), eq(publicationJobs.refId, refId), inArray(publicationJobs.status, ["failed", "blocked"])));
  const orgId = (await orgOf(businessId))!;
  for (const r of rows) {
    await db.update(publicationJobs).set({ status: "queued", lastError: null }).where(eq(publicationJobs.id, r.id));
    await enqueue("publish.run", { publicationId: r.id }, { idempotencyKey: `publish:${r.id}:retry:${Date.now()}`, orgId, businessId });
  }
  if (refType === "content_item" && rows.length) await db.update(contentItems).set({ status: "publishing" }).where(eq(contentItems.id, refId));
  return rows.length;
}
