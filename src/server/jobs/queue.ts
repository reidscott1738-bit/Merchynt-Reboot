import { and, eq, lt, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { jobs } from "../db/schema";
import { AppError, TransientError } from "../errors";

export type EnqueueOptions = {
  runAt?: Date;
  idempotencyKey?: string;
  maxAttempts?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
  queue?: string;
  orgId?: string | null;
  businessId?: string | null;
};

/**
 * Durable Postgres-backed queue. Enqueueing with an idempotency key that
 * already exists returns the existing job instead of creating a duplicate.
 */
export async function enqueue(name: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}, tx: DbOrTx = db) {
  const values = {
    name,
    payload,
    queue: opts.queue ?? "default",
    runAt: opts.runAt ?? new Date(),
    idempotencyKey: opts.idempotencyKey ?? null,
    maxAttempts: opts.maxAttempts ?? 5,
    backoffBaseMs: opts.backoffBaseMs ?? 30_000,
    timeoutMs: opts.timeoutMs ?? 300_000,
    orgId: opts.orgId ?? null,
    businessId: opts.businessId ?? null,
  };
  if (!values.idempotencyKey) {
    const [job] = await tx.insert(jobs).values(values).returning();
    return { job, created: true };
  }
  const inserted = await tx.insert(jobs).values(values).onConflictDoNothing({ target: jobs.idempotencyKey }).returning();
  if (inserted[0]) return { job: inserted[0], created: true };
  const [existing] = await tx.select().from(jobs).where(eq(jobs.idempotencyKey, values.idempotencyKey)).limit(1);
  return { job: existing, created: false };
}

export type JobRow = typeof jobs.$inferSelect;

export async function claimJobs(workerId: string, limit = 5, queues: string[] = ["default", "media"]): Promise<JobRow[]> {
  const result = await db.execute(sql`
    update jobs set status = 'running', locked_by = ${workerId}, locked_at = now(), attempts = attempts + 1
    where id in (
      select id from jobs
      where status = 'pending' and run_at <= now() and queue in ${queues}
      order by run_at, id
      limit ${limit}
      for update skip locked
    )
    returning *`);
  return (result.rows as Record<string, unknown>[]).map(rowToJob);
}

function rowToJob(r: Record<string, unknown>): JobRow {
  return {
    id: Number(r.id),
    queue: r.queue as string,
    name: r.name as string,
    payload: r.payload as Record<string, unknown>,
    status: r.status as JobRow["status"],
    runAt: new Date(r.run_at as string),
    attempts: r.attempts as number,
    maxAttempts: r.max_attempts as number,
    backoffBaseMs: r.backoff_base_ms as number,
    timeoutMs: r.timeout_ms as number,
    lockedBy: r.locked_by as string | null,
    lockedAt: r.locked_at ? new Date(r.locked_at as string) : null,
    lastError: r.last_error as string | null,
    result: r.result as Record<string, unknown> | null,
    idempotencyKey: r.idempotency_key as string | null,
    orgId: r.org_id as string | null,
    businessId: r.business_id as string | null,
    createdAt: new Date(r.created_at as string),
    completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
  };
}

export async function completeJob(id: number, result: Record<string, unknown> = {}) {
  await db.update(jobs).set({ status: "completed", result, completedAt: new Date(), lockedBy: null, lockedAt: null, lastError: null }).where(eq(jobs.id, id));
}

export function backoffDelay(attempt: number, baseMs: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return retryAfterMs;
  const exp = baseMs * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * Math.min(exp * 0.2, 60_000));
  return Math.min(exp + jitter, 6 * 3600_000);
}

/** Permanent errors (validation, missing config, auth) are not retried. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TransientError) return true;
  if (err instanceof AppError) return err.code === "rate_limited";
  return true;
}

export async function failJob(job: JobRow, err: unknown): Promise<"retry" | "dead"> {
  const message = err instanceof Error ? err.message : String(err);
  const retry = isRetryable(err) && job.attempts < job.maxAttempts;
  if (retry) {
    const delay = backoffDelay(job.attempts, job.backoffBaseMs, err instanceof TransientError ? err.retryAfterMs : undefined);
    await db.update(jobs).set({ status: "pending", runAt: new Date(Date.now() + delay), lastError: message.slice(0, 2000), lockedBy: null, lockedAt: null }).where(eq(jobs.id, job.id));
    return "retry";
  }
  await db.update(jobs).set({ status: "dead", lastError: message.slice(0, 2000), completedAt: new Date(), lockedBy: null, lockedAt: null }).where(eq(jobs.id, job.id));
  return "dead";
}

/** Returns jobs whose worker died mid-run to the queue. */
export async function reclaimStaleJobs() {
  const res = await db.execute(sql`
    update jobs set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
      last_error = coalesce(last_error, '') || ' [reclaimed after worker timeout]', locked_by = null, locked_at = null,
      run_at = now()
    where status = 'running' and locked_at < now() - (timeout_ms || ' milliseconds')::interval
    returning id`);
  return res.rows.length;
}

export async function retryDeadJob(id: number) {
  await db.update(jobs).set({ status: "pending", runAt: new Date(), attempts: 0, completedAt: null }).where(and(eq(jobs.id, id), eq(jobs.status, "dead")));
}

export async function cancelJob(id: number) {
  await db.update(jobs).set({ status: "cancelled", completedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.status, "pending")));
}

export async function purgeCompleted(olderThanDays = 30) {
  await db.delete(jobs).where(and(eq(jobs.status, "completed"), lt(jobs.completedAt, new Date(Date.now() - olderThanDays * 86400000))));
}
