/**
 * Background worker: claims jobs from the Postgres queue and runs the
 * automation scheduler. Run one or more instances with `npm run worker`;
 * claiming uses SKIP LOCKED, so instances never run the same job twice.
 */
import { hostname } from "node:os";
import { claimJobs, completeJob, failJob, purgeCompleted, reclaimStaleJobs } from "../server/jobs/queue";
import { runJob } from "../server/jobs/handlers";
import { schedulerTick } from "../server/services/automations";
import { expireOverdueTasks } from "../server/services/tasks";
import { getPool } from "../server/db";

const WORKER_ID = `${hostname()}:${process.pid}`;
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);
const QUEUES = (process.env.WORKER_QUEUES ?? "default,media").split(",").map((q) => q.trim()).filter(Boolean);
let stopping = false;
let active = 0;

function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level, worker: WORKER_ID, msg, ...extra })}\n`);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`Job exceeded ${ms} ms timeout`)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

async function pump() {
  if (stopping || active >= CONCURRENCY) return;
  const jobs = await claimJobs(WORKER_ID, CONCURRENCY - active, QUEUES);
  for (const job of jobs) {
    active++;
    const started = Date.now();
    withTimeout(runJob(job), job.timeoutMs)
      .then(async (result) => {
        await completeJob(job.id, result);
        log("info", "job completed", { id: job.id, name: job.name, ms: Date.now() - started });
      })
      .catch(async (err) => {
        const outcome = await failJob(job, err);
        log(outcome === "dead" ? "error" : "warn", `job ${outcome === "dead" ? "failed permanently" : "will retry"}`, { id: job.id, name: job.name, attempt: job.attempts, error: (err as Error).message });
      })
      .finally(() => {
        active--;
      });
  }
}

async function every(ms: number, name: string, fn: () => Promise<unknown>) {
  while (!stopping) {
    try {
      const r = await fn();
      if (r && typeof r === "object" && Object.values(r).some((v) => typeof v === "number" && v > 0)) log("info", name, r as Record<string, unknown>);
    } catch (e) {
      log("error", `${name} failed`, { error: (e as Error).message });
    }
    await new Promise((r) => setTimeout(r, ms));
  }
}

async function main() {
  log("info", "worker starting", { concurrency: CONCURRENCY, queues: QUEUES });
  void every(1000, "pump", pump);
  void every(30_000, "scheduler", () => schedulerTick());
  void every(60_000, "reclaim", async () => ({ reclaimed: await reclaimStaleJobs() }));
  void every(3600_000, "expire tasks", async () => ({ expired: await expireOverdueTasks() }));
  void every(24 * 3600_000, "purge", async () => {
    await purgeCompleted(30);
    return {};
  });
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log("info", "shutting down", { signal, active });
  const deadline = Date.now() + 30_000;
  while (active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  await getPool().end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
void main();
