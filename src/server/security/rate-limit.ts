import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * Fixed-window counter stored in Postgres so limits hold across instances.
 * Throws a rate_limited AppError once `limit` is exceeded within the window.
 */
export async function consumeRateLimit(key: string, limit: number, windowSeconds: number) {
  const res = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count`);
  const count = Number(res.rows[0]?.count ?? 0);
  if (count > limit) throw new AppError("Too many attempts. Wait a few minutes and try again.", "rate_limited");
  return count;
}
