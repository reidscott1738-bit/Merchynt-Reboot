import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { organizations, usageRecords } from "../db/schema";
import { AppError } from "../errors";
import type { GenerationMeta } from "../ai/provider";

type Metric = (typeof usageRecords.$inferInsert)["metric"];

export async function recordUsage(orgId: string, businessId: string | null, metric: Metric, quantity: number, provider?: string, detail?: Record<string, unknown>) {
  await db.insert(usageRecords).values({ orgId, businessId, metric, quantity, provider: provider ?? null, detail: detail ?? null });
}

export async function recordAiUsage(orgId: string, businessId: string | null, meta: GenerationMeta) {
  await recordUsage(orgId, businessId, "ai_request", 1, meta.provider, { task: meta.task, model: meta.model, isDemo: meta.isDemo });
  if (meta.usage) await recordUsage(orgId, businessId, "ai_tokens", meta.usage.inputTokens + meta.usage.outputTokens, meta.provider, { task: meta.task });
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function monthlyUsage(orgId: string) {
  const rows = await db
    .select({ metric: usageRecords.metric, total: sql<number>`sum(${usageRecords.quantity})::int` })
    .from(usageRecords)
    .where(and(eq(usageRecords.orgId, orgId), gte(usageRecords.createdAt, monthStart())))
    .groupBy(usageRecords.metric);
  return Object.fromEntries(rows.map((r) => [r.metric, r.total])) as Partial<Record<Metric, number>>;
}

const LIMIT_KEYS: Partial<Record<Metric, "monthlyAiRequests" | "monthlyRankingPoints" | "monthlyAiVisibilityQueries" | "monthlyVideoRenders">> = {
  ai_request: "monthlyAiRequests",
  ranking_point: "monthlyRankingPoints",
  ai_visibility_query: "monthlyAiVisibilityQueries",
  video_render: "monthlyVideoRenders",
};

/** Throws before work starts when a plan boundary would be exceeded. */
export async function assertWithinLimit(orgId: string, metric: Metric, needed: number) {
  const key = LIMIT_KEYS[metric];
  if (!key) return;
  const [org] = await db.select({ limits: organizations.limits }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const limit = org?.limits?.[key];
  if (limit == null) return;
  const used = (await monthlyUsage(orgId))[metric] ?? 0;
  if (used + needed > limit) throw new AppError(`This would exceed your plan's monthly limit for ${metric.replace(/_/g, " ")} (${used} of ${limit} used).`, "invalid");
}
