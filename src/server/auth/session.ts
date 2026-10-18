import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { memberships, organizations } from "../db/schema";
import { resolveActor, type Actor } from "../authz";
import { createSessionRecord, deleteSession, lookupSession, SESSION_TTL_MS, setSessionOrg } from "./store";
import { env } from "../env";

export const SESSION_COOKIE = "lp_session";

async function cookieOptions() {
  return {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export async function startSession(userId: string, orgId: string | null) {
  const h = await headers();
  const token = await createSessionRecord(userId, orgId, { ip: h.get("x-forwarded-for")?.split(",")[0] ?? null, userAgent: h.get("user-agent") });
  (await cookies()).set(SESSION_COOKIE, token, await cookieOptions());
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  jar.delete(SESSION_COOKIE);
}

export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await lookupSession(token);
  return row ? { token, session: row.s, user: row.u } : null;
});

/** Current actor, or null if not signed in / no active membership. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const s = await getSession();
  if (!s) return null;
  let orgId = s.session.activeOrgId;
  if (orgId) {
    const actor = await resolveActor(s.user.id, orgId);
    if (actor) return actor;
  }
  const [m] = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, s.user.id), eq(memberships.status, "active"), eq(organizations.status, "active")))
    .limit(1);
  if (!m) return null;
  orgId = m.orgId;
  await setSessionOrg(s.token, orgId);
  return resolveActor(s.user.id, orgId);
});

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    const s = await getSession();
    redirect(s ? "/no-access" : "/login");
  }
  return actor;
}

export async function switchOrg(orgId: string) {
  const s = await getSession();
  if (!s) redirect("/login");
  const actor = await resolveActor(s.user.id, orgId);
  if (!actor) throw new Error("Not a member of that organization");
  await setSessionOrg(s.token, orgId);
}
