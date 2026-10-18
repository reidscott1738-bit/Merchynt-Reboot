import { and, eq, inArray } from "drizzle-orm";
import { can, type Permission } from "@/lib/permissions";
import { db, type DbOrTx } from "./db";
import { businessLocations, memberships, organizations, users, type Role } from "./db/schema";
import { forbidden, notFound } from "./errors";

/** The authenticated principal for a request, resolved server-side. */
export type Actor = {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  orgKind: "agency" | "business";
  role: Role;
  /** null = all clients in the org */
  clientIds: string[] | null;
};

export async function resolveActor(userId: string, orgId: string, tx: DbOrTx = db): Promise<Actor | null> {
  const rows = await tx
    .select({ m: memberships, u: users, o: organizations })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), eq(memberships.status, "active")))
    .limit(1);
  const r = rows[0];
  if (!r || r.u.deactivatedAt || r.o.status !== "active") return null;
  return {
    userId: r.u.id,
    email: r.u.email,
    name: r.u.name,
    orgId: r.o.id,
    orgName: r.o.name,
    orgKind: r.o.kind,
    role: r.m.role,
    clientIds: r.m.clientIds && r.m.clientIds.length ? r.m.clientIds : r.m.role === "client_approver" ? [] : null,
  };
}

export function assertCan(actor: Actor, permission: Permission) {
  if (!can(actor.role, permission)) throw forbidden();
}

/**
 * Loads a business the actor may access. Returns 404 (not 403) for businesses
 * in other tenants so ids cannot be probed.
 */
export async function requireBusiness(actor: Actor, businessId: string, permission: Permission = "business.view", tx: DbOrTx = db) {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) throw notFound("Business");
  const [b] = await tx.select().from(businessLocations).where(and(eq(businessLocations.id, businessId), eq(businessLocations.orgId, actor.orgId))).limit(1);
  if (!b) throw notFound("Business");
  if (actor.clientIds !== null && (!b.clientId || !actor.clientIds.includes(b.clientId))) throw notFound("Business");
  assertCan(actor, permission);
  return b;
}

export async function accessibleBusinesses(actor: Actor, tx: DbOrTx = db) {
  const base = and(eq(businessLocations.orgId, actor.orgId), eq(businessLocations.status, "active"));
  if (actor.clientIds === null) return tx.select().from(businessLocations).where(base).orderBy(businessLocations.name);
  if (actor.clientIds.length === 0) return [];
  return tx.select().from(businessLocations).where(and(base, inArray(businessLocations.clientId, actor.clientIds))).orderBy(businessLocations.name);
}
