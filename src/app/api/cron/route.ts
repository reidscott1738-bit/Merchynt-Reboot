import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import "@/server/services/register";
import { schedulerTick } from "@/server/services/automations";
import { expireOverdueTasks } from "@/server/services/tasks";
import { reclaimStaleJobs } from "@/server/jobs/queue";

/**
 * For hosts without a long-running worker clock: queues due automations.
 * Jobs still run in the worker process. Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [scheduled, reclaimed, expired] = await Promise.all([schedulerTick(), reclaimStaleJobs(), expireOverdueTasks()]);
  return Response.json({ ok: true, scheduled, reclaimed, expired });
}
