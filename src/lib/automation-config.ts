import { z } from "zod";
import type { AutomationSchedule, AutomationType } from "@/server/db/schema";

export const postingConfig = z.object({
  postsPerWeek: z.number().int().min(1).max(7).default(2),
  batchSize: z.number().int().min(1).max(12).default(4),
  imageSource: z.enum(["uploaded_only", "uploaded_then_gbp", "allow_ai"]).default("uploaded_then_gbp"),
  imageReuseDays: z.number().int().min(0).max(365).default(30),
  imageMode: z.enum(["raw", "branded"]).default("raw"),
  cta: z.enum(["LEARN_MORE", "CALL", "BOOK", "ORDER", "SHOP", "SIGN_UP"]).default("LEARN_MORE"),
  customCtaText: z.string().max(40).optional(),
  approvalMode: z.enum(["none", "all", "branded_or_ai"]).default("all"),
  destinations: z.array(z.enum(["google", "facebook", "instagram", "linkedin"])).default(["google"]),
  holidayReferences: z.boolean().default(true),
});

export const reviewRepliesConfig = z.object({
  /** How far back the historical processor looks, documented as six months. */
  historicalLookbackDays: z.number().int().min(1).max(730).default(180),
  historicalPerRun: z.number().int().min(1).max(25).default(5),
  signOff: z.string().max(80).optional(),
});

export const reviewRequestsConfig = z.object({
  campaignIds: z.array(z.string().uuid()).default([]),
});

export const reportingConfig = z.object({
  recipients: z.array(z.string().email()).default([]),
  comparisonPeriod: z.enum(["previous_period", "previous_year"]).default("previous_period"),
  includeSections: z
    .array(z.enum(["performance", "lead_actions", "rankings", "competitors", "ai_visibility", "reviews", "activity"]))
    .default(["performance", "lead_actions", "rankings", "competitors", "ai_visibility", "reviews", "activity"]),
});

export const rankingAuditConfig = z.object({ keywordIds: z.array(z.string().uuid()).default([]) });
export const aiVisibilityConfig = z.object({
  providers: z.array(z.string()).default(["anthropic", "openai", "gemini", "perplexity"]),
  queriesPerKeyword: z.number().int().min(1).max(3).default(1),
});
export const faqConfig = z.object({ perRun: z.number().int().min(1).max(10).default(3), approvalMode: z.enum(["none", "all"]).default("all") });
export const videoConfig = z.object({
  format: z.enum(["vertical", "horizontal"]).default("vertical"),
  approvalMode: z.enum(["none", "all"]).default("all"),
  destinations: z.array(z.enum(["google", "youtube", "facebook", "instagram", "linkedin"])).default([]),
});
export const websiteUpdatesConfig = z.object({ autoPublishFaqs: z.boolean().default(false) });
export const emptyConfig = z.object({});

export const AUTOMATION_META: Record<
  AutomationType,
  { label: string; description: string; publishes: boolean; schema: z.ZodTypeAny; defaultSchedule: AutomationSchedule; recommendedEnabled: boolean }
> = {
  posting: { label: "Google posts", description: "Generates posts from your verified business facts and keywords, then publishes on schedule.", publishes: true, schema: postingConfig, defaultSchedule: { frequency: "weekly", daysOfWeek: [1, 4], time: "10:00" }, recommendedEnabled: true },
  review_replies: { label: "Review replies", description: "Drafts or publishes replies to new reviews following your per-star rules.", publishes: true, schema: reviewRepliesConfig, defaultSchedule: { frequency: "hourly", time: "00:15" }, recommendedEnabled: true },
  historical_reviews: { label: "Older unanswered reviews", description: "Works through unanswered reviews from the lookback window, a few per day.", publishes: true, schema: reviewRepliesConfig, defaultSchedule: { frequency: "daily", time: "09:00" }, recommendedEnabled: true },
  review_requests: { label: "Review requests", description: "Sends due review-request emails and follow-ups within daily limits.", publishes: false, schema: reviewRequestsConfig, defaultSchedule: { frequency: "hourly", time: "00:05" }, recommendedEnabled: true },
  faq_generation: { label: "FAQ generation", description: "Adds new FAQs drafted from verified facts.", publishes: false, schema: faqConfig, defaultSchedule: { frequency: "weekly", daysOfWeek: [2], time: "08:00" }, recommendedEnabled: false },
  website_updates: { label: "Website updates", description: "Adds approved FAQs and videos to your generated website.", publishes: true, schema: websiteUpdatesConfig, defaultSchedule: { frequency: "weekly", daysOfWeek: [3], time: "06:00" }, recommendedEnabled: false },
  video_generation: { label: "Video generation", description: "Builds a slideshow video from approved photos with narration and music.", publishes: true, schema: videoConfig, defaultSchedule: { frequency: "monthly", dayOfMonth: 15, time: "09:00" }, recommendedEnabled: false },
  reporting: { label: "Monthly report", description: "Builds the monthly report from recorded data and emails it.", publishes: false, schema: reportingConfig, defaultSchedule: { frequency: "monthly", dayOfMonth: 2, time: "08:00" }, recommendedEnabled: true },
  ranking_audit: { label: "Ranking audits", description: "Runs grid ranking audits for tracked keywords.", publishes: false, schema: rankingAuditConfig, defaultSchedule: { frequency: "monthly", dayOfMonth: 1, time: "05:00" }, recommendedEnabled: true },
  ai_visibility_audit: { label: "AI visibility audits", description: "Asks AI assistants local questions and records whether you are mentioned.", publishes: false, schema: aiVisibilityConfig, defaultSchedule: { frequency: "monthly", dayOfMonth: 1, time: "06:00" }, recommendedEnabled: false },
  integration_health: { label: "Connection health checks", description: "Checks connected accounts and alerts you when one needs attention.", publishes: false, schema: emptyConfig, defaultSchedule: { frequency: "daily", time: "04:00" }, recommendedEnabled: true },
  account_manager: { label: "Account manager reminders", description: "Emails reminders about pending approvals, failures and missing details.", publishes: false, schema: emptyConfig, defaultSchedule: { frequency: "daily", time: "08:30" }, recommendedEnabled: true },
};

export function defaultConfig(type: AutomationType): Record<string, unknown> {
  return AUTOMATION_META[type].schema.parse({}) as Record<string, unknown>;
}

export function parseConfig<T extends AutomationType>(type: T, raw: unknown) {
  return AUTOMATION_META[type].schema.safeParse(raw ?? {});
}
