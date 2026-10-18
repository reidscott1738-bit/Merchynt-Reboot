import "server-only";
import "./services/register";
import { notFound } from "next/navigation";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { requireActor } from "./auth/session";
import { requireBusiness, type Actor } from "./authz";
import { can, type Permission } from "@/lib/permissions";
import { AppError } from "./errors";
import { db } from "./db";
import { memberships, organizations } from "./db/schema";

/** Loads the business for a page, turning access errors into a 404. */
export const businessPage = cache(async (businessId: string) => {
  const actor = await requireActor();
  try {
    const business = await requireBusiness(actor, businessId);
    return { actor, business, can: (p: Permission) => can(actor.role, p) };
  } catch (e) {
    if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
});

export const orgPage = cache(async () => {
  const actor = await requireActor();
  return { actor, can: (p: Permission) => can(actor.role, p) };
});

export async function userOrgs(actor: Actor) {
  return db
    .select({ id: organizations.id, name: organizations.name, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, actor.userId), eq(memberships.status, "active"), eq(organizations.status, "active")))
    .orderBy(organizations.name);
}

export type SP = Promise<Record<string, string | undefined>>;
