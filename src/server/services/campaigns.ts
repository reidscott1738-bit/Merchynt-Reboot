import { and, asc, count, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { businessLocations, campaignContacts, emailMessages, mediaAssets, reviewCampaigns, reviewLinkEvents, reviewLinks, suppressions } from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { AppError, invalid, notFound } from "../errors";
import { randomToken } from "../security/crypto";
import { queueEmail } from "../email";
import { button, layout, paragraph } from "../email/templates";
import { env } from "../env";
import { parseContactsCsv } from "@/lib/csv-contacts";
import { normalizeEmail, isValidEmail, slugify } from "@/lib/text";
import { toLocalParts } from "@/lib/time";
import { ingestMedia } from "./media";
import { createTask, registerTaskHandler } from "./tasks";
import { publicMediaUrl } from "../storage";

export type Campaign = typeof reviewCampaigns.$inferSelect;
export type Contact = typeof campaignContacts.$inferSelect;

const appUrl = () => env().APP_URL.replace(/\/$/, "");

/* ---------------- Review links ---------------- */

export function reviewLinkUrl(reviewSlug: string, linkSlug?: string | null, contactToken?: string | null) {
  const base = `${appUrl()}/r/${reviewSlug}${linkSlug ? `/${linkSlug}` : ""}`;
  return contactToken ? `${base}?c=${encodeURIComponent(contactToken)}` : base;
}

export async function listReviewLinks(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  const links = await db.select().from(reviewLinks).where(and(eq(reviewLinks.businessId, businessId), isNull(reviewLinks.archivedAt))).orderBy(desc(reviewLinks.createdAt));
  const stats = links.length
    ? await db.select({ linkId: reviewLinkEvents.linkId, type: reviewLinkEvents.type, n: count() }).from(reviewLinkEvents).where(inArray(reviewLinkEvents.linkId, links.map((l) => l.id))).groupBy(reviewLinkEvents.linkId, reviewLinkEvents.type)
    : [];
  return links.map((l) => ({ ...l, stats: Object.fromEntries(stats.filter((s) => s.linkId === l.id).map((s) => [s.type, s.n])) as Record<string, number> }));
}

export async function createReviewLink(actor: Actor, businessId: string, input: { label: string; salesperson?: string | null; service?: string | null; photoBoostEnabled?: boolean }) {
  await requireBusiness(actor, businessId, "campaigns.manage");
  const label = input.label.trim();
  if (!label) throw invalid("Give the link a name");
  let slug = slugify(label, 30) || "link";
  for (let i = 2; ; i++) {
    const [exists] = await db.select({ id: reviewLinks.id }).from(reviewLinks).where(and(eq(reviewLinks.businessId, businessId), eq(reviewLinks.slug, slug))).limit(1);
    if (!exists) break;
    slug = `${slugify(label, 26)}-${i}`;
  }
  const [link] = await db.insert(reviewLinks).values({ businessId, slug, label, salesperson: input.salesperson ?? null, service: input.service ?? null, photoBoostEnabled: input.photoBoostEnabled ?? true }).returning();
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "review_link.created", target: { type: "review_link", id: link.id } });
  return link;
}

export async function archiveReviewLink(actor: Actor, businessId: string, linkId: string) {
  await requireBusiness(actor, businessId, "campaigns.manage");
  await db.update(reviewLinks).set({ archivedAt: new Date() }).where(and(eq(reviewLinks.id, linkId), eq(reviewLinks.businessId, businessId)));
}

/**
 * Public review page data. Every visitor gets the same path to Google, so the
 * page cannot be used to filter out unhappy customers (review gating).
 */
export async function getPublicReviewPage(reviewSlug: string, linkSlug?: string | null, contactToken?: string | null) {
  const [b] = await db.select().from(businessLocations).where(and(eq(businessLocations.reviewSlug, reviewSlug), eq(businessLocations.status, "active"))).limit(1);
  if (!b) return null;
  const [link] = linkSlug ? await db.select().from(reviewLinks).where(and(eq(reviewLinks.businessId, b.id), eq(reviewLinks.slug, linkSlug), isNull(reviewLinks.archivedAt))).limit(1) : [null];
  if (linkSlug && !link) return null;
  const [contact] = contactToken ? await db.select().from(campaignContacts).where(and(eq(campaignContacts.optOutToken, contactToken), eq(campaignContacts.businessId, b.id))).limit(1) : [null];
  return {
    business: { id: b.id, name: b.name, logoUrl: b.logoAssetId ? publicMediaUrl(b.logoAssetId, "thumb") : null, color: b.brand?.primaryColor ?? "#2563eb", googleReviewUrl: b.googleReviewUrl, orgId: b.orgId },
    link: link ? { id: link.id, label: link.label, photoBoostEnabled: link.photoBoostEnabled } : null,
    photoBoostEnabled: link ? link.photoBoostEnabled : true,
    contact: contact ? { id: contact.id, firstName: contact.name?.split(/\s+/)[0] ?? null } : null,
  };
}

export async function recordLinkEvent(businessId: string, linkId: string | null, contactId: string | null, type: (typeof reviewLinkEvents.$inferInsert)["type"], meta?: Record<string, unknown>) {
  await db.insert(reviewLinkEvents).values({ businessId, linkId, contactId, type, meta: meta ?? null });
  if (contactId && type === "continue_to_google") {
    await db.update(campaignContacts).set({ status: "clicked", clickedAt: new Date(), nextSendAt: null }).where(and(eq(campaignContacts.id, contactId), inArray(campaignContacts.status, ["enrolled", "sent", "followed_up"])));
  }
}

/**
 * Photo Boost: a customer adds photos of the finished work. Google offers no
 * API to attach photos to a customer's review, so photos land in the
 * business's library for approval and can then be added to the profile gallery.
 */
export async function submitPhotoBoost(reviewSlug: string, linkSlug: string | null, contactToken: string | null, files: { data: Buffer; filename: string }[], input: { name?: string | null; consent: boolean; caption?: string | null }) {
  const page = await getPublicReviewPage(reviewSlug, linkSlug, contactToken);
  if (!page) throw new AppError("This page is no longer available", "not_found");
  if (!page.photoBoostEnabled) throw invalid("Photo uploads are turned off for this link");
  if (!input.consent) throw invalid("Please confirm the business may use your photos");
  if (!files.length) throw invalid("Choose at least one photo");
  if (files.length > 6) throw invalid("Upload up to 6 photos");
  const ids: string[] = [];
  for (const f of files) {
    const { asset } = await ingestMedia({
      businessId: page.business.id,
      data: f.data,
      filename: f.filename,
      source: "photo_boost",
      contributorName: input.name ?? null,
      caption: input.caption ?? null,
      consent: { marketingUse: true, capturedAt: new Date().toISOString(), text: "Customer agreed the business may use these photos in its marketing." },
      moderationStatus: "pending",
    });
    if (asset.kind !== "image") throw invalid("Only photos can be uploaded here");
    ids.push(asset.id);
  }
  await recordLinkEvent(page.business.id, page.link?.id ?? null, page.contact?.id ?? null, "photo_uploaded", { count: ids.length });
  await createTask({
    orgId: page.business.orgId,
    businessId: page.business.id,
    type: "photo",
    title: `Review ${ids.length} customer photo${ids.length > 1 ? "s" : ""}`,
    summary: input.caption ?? `Uploaded by ${input.name ?? "a customer"} from the review page`,
    refType: "photo_boost",
    refId: ids[0],
  });
  return { uploaded: ids.length };
}

registerTaskHandler("photo_boost", {
  async preview(task) {
    const [a] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, task.refId)).limit(1);
    return { title: task.title, body: a?.description ?? "Customer photo", imageUrl: a ? publicMediaUrl(a.id, "web", true) : null, meta: { From: a?.contributorName ?? "Customer" } };
  },
  async onApprove(task) {
    const [first] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, task.refId)).limit(1);
    if (!first) return { skipped: "deleted" };
    // Approve the batch uploaded in the same submission (same contributor, within a minute).
    const batch = await db
      .update(mediaAssets)
      .set({ moderationStatus: "approved" })
      .where(and(eq(mediaAssets.businessId, first.businessId), eq(mediaAssets.source, "photo_boost"), eq(mediaAssets.moderationStatus, "pending"), sql`abs(extract(epoch from ${mediaAssets.createdAt} - ${first.createdAt})) < 120`))
      .returning({ id: mediaAssets.id });
    const { enqueue } = await import("../jobs/queue");
    for (const a of batch) await enqueue("media.pushGoogle", { assetId: a.id }, { idempotencyKey: `media-push-google:${a.id}`, businessId: first.businessId });
    return { approved: batch.length };
  },
  async onReject(task) {
    const [first] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, task.refId)).limit(1);
    if (!first) return;
    await db
      .update(mediaAssets)
      .set({ moderationStatus: "rejected", useForPosts: false, useForWebsite: false, useForVideos: false, useForGoogleMedia: false })
      .where(and(eq(mediaAssets.businessId, first.businessId), eq(mediaAssets.source, "photo_boost"), eq(mediaAssets.moderationStatus, "pending"), sql`abs(extract(epoch from ${mediaAssets.createdAt} - ${first.createdAt})) < 120`));
  },
});

/* ---------------- Campaigns ---------------- */

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(150),
  messageTemplate: z.string().trim().min(10).max(3000),
  followUp: z.object({ enabled: z.boolean(), delayDays: z.number().int().min(1).max(30), maxFollowUps: z.number().int().min(0).max(3), messageTemplate: z.string().max(3000).optional() }),
  dailyLimit: z.number().int().min(1).max(500),
  sendWindow: z.object({ startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24) }).refine((w) => w.endHour > w.startHour, "The send window must end after it starts"),
  linkId: z.string().uuid().nullable().optional(),
});

export const DEFAULT_CAMPAIGN = {
  subject: "How did we do, {first_name}?",
  messageTemplate: "Hi {first_name},\n\nThank you for choosing {business_name}. If you have a minute, we'd really appreciate hearing about your experience on Google. Your feedback helps us and helps neighbors find a business they can trust.",
  followUp: { enabled: true, delayDays: 4, maxFollowUps: 1, messageTemplate: "Hi {first_name}, just a quick reminder in case you have a moment to share your experience with {business_name}. Thank you!" },
  dailyLimit: 50,
  sendWindow: { startHour: 9, endHour: 18 },
};

export async function createCampaign(actor: Actor, businessId: string, raw: unknown) {
  await requireBusiness(actor, businessId, "campaigns.manage");
  const input = campaignSchema.parse(raw);
  if (input.linkId) {
    const [l] = await db.select().from(reviewLinks).where(and(eq(reviewLinks.id, input.linkId), eq(reviewLinks.businessId, businessId))).limit(1);
    if (!l) throw invalid("That review link does not belong to this business");
  }
  const [c] = await db.insert(reviewCampaigns).values({ businessId, ...input, linkId: input.linkId ?? null, createdByUserId: actor.userId }).returning();
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "campaign.created", target: { type: "campaign", id: c.id } });
  return c;
}

async function requireCampaign(actor: Actor, businessId: string, id: string, permission: "business.view" | "campaigns.manage" = "business.view") {
  await requireBusiness(actor, businessId, permission);
  const [c] = await db.select().from(reviewCampaigns).where(and(eq(reviewCampaigns.id, id), eq(reviewCampaigns.businessId, businessId))).limit(1);
  if (!c) throw notFound("Campaign");
  return c;
}

export async function updateCampaign(actor: Actor, businessId: string, id: string, raw: unknown) {
  const c = await requireCampaign(actor, businessId, id, "campaigns.manage");
  if (["sending", "completed"].includes(c.status)) throw invalid("Pause the campaign before editing it");
  const input = campaignSchema.partial().parse(raw);
  const [u] = await db.update(reviewCampaigns).set({ ...input, updatedAt: new Date() }).where(eq(reviewCampaigns.id, id)).returning();
  return u;
}

/** Imports contacts from CSV text. Invalid, duplicate and suppressed rows are kept with a reason, never sent. */
export async function importContacts(actor: Actor, businessId: string, campaignId: string, csv: string) {
  const c = await requireCampaign(actor, businessId, campaignId, "campaigns.manage");
  if (c.status === "completed") throw invalid("This campaign is complete");
  const supp = await db.select({ e: suppressions.emailNormalized }).from(suppressions).where(eq(suppressions.orgId, actor.orgId));
  const existing = await db.select({ e: campaignContacts.emailNormalized }).from(campaignContacts).where(eq(campaignContacts.campaignId, campaignId));
  const parsed = parseContactsCsv(csv, { suppressed: new Set(supp.map((s) => s.e)), existing: new Set(existing.map((e) => e.e).filter((x): x is string => !!x)), maxRows: 5000 });
  if (parsed.headerErrors.length) throw invalid(parsed.headerErrors.join("; "));
  let inserted = 0;
  for (const row of parsed.contacts) {
    const res = await db
      .insert(campaignContacts)
      .values({
        campaignId,
        businessId,
        name: row.name,
        email: row.email,
        emailNormalized: row.status === "invalid" ? null : row.emailNormalized,
        phone: row.phone,
        serviceLabel: row.serviceLabel,
        salesperson: row.salesperson,
        status: row.status,
        validationErrors: row.errors.length ? row.errors : null,
        optOutToken: randomToken(18),
      })
      .onConflictDoNothing()
      .returning({ id: campaignContacts.id });
    if (res[0]) inserted++;
  }
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "campaign.contacts_imported", target: { type: "campaign", id: campaignId }, detail: parsed.summary });
  return { ...parsed.summary, inserted };
}

export async function addContact(actor: Actor, businessId: string, campaignId: string, input: { name?: string; email: string }) {
  await requireCampaign(actor, businessId, campaignId, "campaigns.manage");
  if (!isValidEmail(input.email)) throw invalid("Enter a valid email address");
  const e = normalizeEmail(input.email);
  const [s] = await db.select().from(suppressions).where(and(eq(suppressions.orgId, actor.orgId), eq(suppressions.emailNormalized, e))).limit(1);
  const [row] = await db
    .insert(campaignContacts)
    .values({ campaignId, businessId, name: input.name ?? null, email: input.email.trim(), emailNormalized: e, status: s ? "suppressed" : "pending", optOutToken: randomToken(18) })
    .onConflictDoNothing()
    .returning();
  if (!row) throw invalid("That email is already in this campaign");
  return row;
}

export async function campaignSummary(campaignId: string) {
  const rows = await db.select({ status: campaignContacts.status, n: count() }).from(campaignContacts).where(eq(campaignContacts.campaignId, campaignId)).groupBy(campaignContacts.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const total = rows.reduce((a, r) => a + r.n, 0);
  const sendable = (by.pending ?? 0) + (by.enrolled ?? 0) + (by.sent ?? 0) + (by.followed_up ?? 0) + (by.clicked ?? 0) + (by.completed ?? 0);
  return { total, by, sendable };
}

export async function listCampaigns(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  const rows = await db.select().from(reviewCampaigns).where(eq(reviewCampaigns.businessId, businessId)).orderBy(desc(reviewCampaigns.createdAt));
  return Promise.all(rows.map(async (c) => ({ ...c, summary: await campaignSummary(c.id) })));
}

export async function getCampaign(actor: Actor, businessId: string, id: string) {
  const c = await requireCampaign(actor, businessId, id);
  const contacts = await db.select().from(campaignContacts).where(eq(campaignContacts.campaignId, id)).orderBy(asc(campaignContacts.createdAt)).limit(1000);
  return { campaign: c, contacts, summary: await campaignSummary(id) };
}

/** Checks a campaign can send; moves draft to validated and returns blocking problems. */
export async function validateCampaign(actor: Actor, businessId: string, id: string) {
  const c = await requireCampaign(actor, businessId, id, "campaigns.manage");
  const b = await requireBusiness(actor, businessId);
  const problems: string[] = [];
  if (!b.googleReviewUrl) problems.push("Add the Google review link for this business (Business Profile settings) so customers have somewhere to leave the review.");
  if (!b.addressLine1 && !b.city) problems.push("Add the business mailing address; marketing email must include a physical address.");
  const s = await campaignSummary(id);
  if (!s.by.pending && !s.by.enrolled) problems.push("Add at least one valid contact.");
  if (!c.messageTemplate.includes("{first_name}") && !c.messageTemplate.includes("{business_name}")) problems.push("Personalize the message with {first_name} or {business_name}.");
  if (!problems.length && c.status === "draft") await db.update(reviewCampaigns).set({ status: "validated", updatedAt: new Date() }).where(eq(reviewCampaigns.id, id));
  return { ok: problems.length === 0, problems, summary: s };
}

export async function startCampaign(actor: Actor, businessId: string, id: string, startAt?: Date | null) {
  const v = await validateCampaign(actor, businessId, id);
  if (!v.ok) throw invalid(v.problems.join(" "));
  const at = startAt && startAt > new Date() ? startAt : new Date();
  await db.update(campaignContacts).set({ status: "enrolled", enrolledAt: new Date(), nextSendAt: at }).where(and(eq(campaignContacts.campaignId, id), eq(campaignContacts.status, "pending")));
  await db.update(reviewCampaigns).set({ status: at > new Date() ? "scheduled" : "sending", startAt: at, pausedAt: null, updatedAt: new Date() }).where(eq(reviewCampaigns.id, id));
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "campaign.started", target: { type: "campaign", id } });
}

export async function pauseCampaign(actor: Actor, businessId: string, id: string) {
  const c = await requireCampaign(actor, businessId, id, "campaigns.manage");
  if (!["sending", "scheduled"].includes(c.status)) throw invalid("Only running campaigns can be paused");
  await db.update(reviewCampaigns).set({ status: "paused", pausedAt: new Date(), updatedAt: new Date() }).where(eq(reviewCampaigns.id, id));
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "campaign.paused", target: { type: "campaign", id } });
}

export async function resumeCampaign(actor: Actor, businessId: string, id: string) {
  const c = await requireCampaign(actor, businessId, id, "campaigns.manage");
  if (c.status !== "paused") throw invalid("Only paused campaigns can be resumed");
  await db.update(campaignContacts).set({ status: "enrolled", enrolledAt: new Date(), nextSendAt: new Date() }).where(and(eq(campaignContacts.campaignId, id), eq(campaignContacts.status, "pending")));
  await db.update(reviewCampaigns).set({ status: "sending", pausedAt: null, updatedAt: new Date() }).where(eq(reviewCampaigns.id, id));
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "campaign.resumed", target: { type: "campaign", id } });
}

function fill(tpl: string, vars: { first_name: string; business_name: string }) {
  return tpl.replaceAll("{first_name}", vars.first_name).replaceAll("{business_name}", vars.business_name);
}

function inSendWindow(now: Date, tz: string, w: { startHour: number; endHour: number }) {
  const p = toLocalParts(now, tz);
  return p.hour >= w.startHour && p.hour < w.endHour;
}

/** Sends due emails for one campaign, respecting the window and the per-day limit in the business timezone. */
export async function sendDueForCampaign(campaignId: string, now = new Date()) {
  const [c] = await db.select().from(reviewCampaigns).where(eq(reviewCampaigns.id, campaignId)).limit(1);
  if (!c) return { skipped: "missing" };
  if (c.status === "scheduled" && c.startAt && c.startAt <= now) await db.update(reviewCampaigns).set({ status: "sending" }).where(eq(reviewCampaigns.id, c.id));
  else if (c.status !== "sending") return { skipped: c.status };
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, c.businessId)).limit(1);
  if (!b.googleReviewUrl) return { skipped: "No Google review link on file" };
  if (!inSendWindow(now, b.timezone, c.sendWindow)) return { skipped: "Outside the send window" };

  const local = toLocalParts(now, b.timezone);
  const dayStart = new Date(now.getTime() - (local.hour * 3600 + local.minute * 60) * 1000);
  const [{ sentToday }] = await db
    .select({ sentToday: count() })
    .from(emailMessages)
    .where(and(eq(emailMessages.relatedType, "campaign"), eq(emailMessages.relatedId, c.id), sql`${emailMessages.createdAt} >= ${dayStart}`));
  const budget = c.dailyLimit - sentToday;
  if (budget <= 0) return { skipped: "Daily limit reached" };

  const [link] = c.linkId ? await db.select().from(reviewLinks).where(eq(reviewLinks.id, c.linkId)).limit(1) : [null];
  const due = await db
    .select()
    .from(campaignContacts)
    .where(and(eq(campaignContacts.campaignId, c.id), inArray(campaignContacts.status, ["enrolled", "sent", "followed_up"]), lte(campaignContacts.nextSendAt, now)))
    .orderBy(asc(campaignContacts.nextSendAt))
    .limit(budget);

  const brand = { name: b.name, color: b.brand?.primaryColor ?? "#2563eb", logoUrl: b.logoAssetId ? publicMediaUrl(b.logoAssetId, "thumb", true) : null };
  const address = [b.addressLine1, b.city, b.region, b.postalCode].filter(Boolean).join(", ");
  let sent = 0;
  for (const ct of due) {
    const isFollowUp = ct.sends > 0;
    if (isFollowUp && (!c.followUp.enabled || ct.sends > c.followUp.maxFollowUps)) {
      await db.update(campaignContacts).set({ status: "completed", nextSendAt: null }).where(eq(campaignContacts.id, ct.id));
      continue;
    }
    // Claim the contact so overlapping ticks cannot double-send.
    const [claimed] = await db
      .update(campaignContacts)
      .set({ nextSendAt: null })
      .where(and(eq(campaignContacts.id, ct.id), lte(campaignContacts.nextSendAt, now)))
      .returning();
    if (!claimed || !ct.email) continue;
    const vars = { first_name: ct.name?.split(/\s+/)[0] ?? "there", business_name: b.name };
    const body = fill(isFollowUp ? (c.followUp.messageTemplate || c.messageTemplate) : c.messageTemplate, vars);
    const url = reviewLinkUrl(b.reviewSlug, link?.slug, ct.optOutToken);
    const unsub = `${appUrl()}/u/${ct.optOutToken}`;
    const msg = await queueEmail({
      orgId: b.orgId,
      to: ct.email,
      subject: fill(isFollowUp ? `Reminder: ${c.subject}` : c.subject, vars),
      html: layout({ ...brand, footer: `${b.name}${address ? ` · ${address}` : ""}` }, fill(c.subject, vars), paragraph(body) + button(url, "Leave a review", brand.color) + `<p style="font-size:12px;color:#6b7280;margin-top:20px">Don't want these emails? <a href="${unsub}">Unsubscribe</a>.</p>`),
      text: `${body}\n\nLeave a review: ${url}\n\n${b.name}${address ? `, ${address}` : ""}\nUnsubscribe: ${unsub}`,
      template: isFollowUp ? "review_request_followup" : "review_request",
      related: { type: "campaign", id: c.id },
      marketing: true,
    });
    const suppressed = msg.status === "suppressed";
    const sends = ct.sends + (suppressed ? 0 : 1);
    const moreFollowUps = !suppressed && c.followUp.enabled && sends <= c.followUp.maxFollowUps;
    await db
      .update(campaignContacts)
      .set({
        status: suppressed ? "suppressed" : isFollowUp ? "followed_up" : "sent",
        sends,
        lastSentAt: suppressed ? ct.lastSentAt : now,
        nextSendAt: moreFollowUps ? new Date(now.getTime() + c.followUp.delayDays * 86400_000) : null,
      })
      .where(eq(campaignContacts.id, ct.id));
    if (!suppressed) sent++;
  }

  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(campaignContacts)
    .where(and(eq(campaignContacts.campaignId, c.id), or(eq(campaignContacts.status, "enrolled"), and(inArray(campaignContacts.status, ["sent", "followed_up"]), sql`${campaignContacts.nextSendAt} is not null`))));
  if (!remaining) {
    await db.update(campaignContacts).set({ status: "completed" }).where(and(eq(campaignContacts.campaignId, c.id), inArray(campaignContacts.status, ["sent", "followed_up"])));
    await db.update(reviewCampaigns).set({ status: "completed", completedAt: now }).where(eq(reviewCampaigns.id, c.id));
    await logActivity({ orgId: b.orgId, businessId: b.id, actor: systemActor, action: "campaign.completed", target: { type: "campaign", id: c.id } });
  }
  return { sent, remaining };
}

export async function sendDueForBusiness(businessId: string, campaignIds?: string[]) {
  const conds = [eq(reviewCampaigns.businessId, businessId), inArray(reviewCampaigns.status, ["sending", "scheduled"])];
  if (campaignIds?.length) conds.push(inArray(reviewCampaigns.id, campaignIds));
  const rows = await db.select({ id: reviewCampaigns.id }).from(reviewCampaigns).where(and(...conds));
  const results: Record<string, unknown> = {};
  for (const r of rows) results[r.id] = await sendDueForCampaign(r.id);
  return results;
}

/** One-click unsubscribe. Adds an org-wide suppression so no campaign emails this address again. */
export async function optOut(token: string) {
  const [ct] = await db.select().from(campaignContacts).where(eq(campaignContacts.optOutToken, token)).limit(1);
  if (!ct) return null;
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, ct.businessId)).limit(1);
  if (ct.emailNormalized) {
    await db.insert(suppressions).values({ orgId: b.orgId, businessId: b.id, emailNormalized: ct.emailNormalized, reason: "opt_out" }).onConflictDoNothing();
    await db.update(campaignContacts).set({ status: "opted_out", nextSendAt: null }).where(and(eq(campaignContacts.emailNormalized, ct.emailNormalized), sql`${campaignContacts.businessId} in (select id from business_locations where org_id = ${b.orgId})`));
  }
  await recordLinkEvent(b.id, null, ct.id, "opt_out");
  return { businessName: b.name };
}
