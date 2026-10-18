import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __pool?: Pool; __db?: Db };

function url() {
  return process.env.DATABASE_URL ?? "postgres://localpilot:localpilot@localhost:5432/localpilot";
}

export function getPool(): Pool {
  if (!globalForDb.__pool) {
    globalForDb.__pool = new Pool({ connectionString: url(), max: Number(process.env.DB_POOL_MAX ?? 10) });
  }
  return globalForDb.__pool;
}

export const db: Db = globalForDb.__db ?? (globalForDb.__db = drizzle(getPool(), { schema }));

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export { schema };
