import { sql } from "drizzle-orm";
import { db, getPool } from "@/server/db";
import { signUp } from "@/server/auth/store";
import { resolveActor, type Actor } from "@/server/authz";
import { createBusiness } from "@/server/services/business";
import { randomToken } from "@/server/security/crypto";

/** Empties every application table in the test database. Refuses to run against any other database. */
export async function resetDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localpilot_test/.test(url)) throw new Error(`Refusing to reset non-test database: ${url}`);
  const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = rows.rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

export async function makeOrg(kind: "agency" | "business" = "agency"): Promise<Actor> {
  const email = `owner-${randomToken(6).toLowerCase()}@example.test`;
  const { user, org } = await signUp({ name: "Owner", email, password: "correct horse battery", orgName: `Org ${randomToken(4)}`, orgKind: kind });
  const actor = await resolveActor(user.id, org.id);
  if (!actor) throw new Error("actor not resolved");
  return actor;
}

export async function makeBusiness(actor: Actor, overrides: Record<string, unknown> = {}) {
  return createBusiness(actor, { name: "Acme Plumbing", phone: "(512) 555-0100", city: "Austin", region: "TX", country: "US", primaryCategory: "Plumber", timezone: "America/Chicago", latitude: 30.2672, longitude: -97.7431, googleReviewUrl: "https://g.page/r/example/review", ...overrides });
}

export async function closeDb() {
  await getPool().end();
}
