import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  activityEvents,
  automationRules,
  businessLocations,
  clients,
  integrations,
  invitations,
  memberships,
  organizationBranding,
  organizations,
  ROLES,
  tasks,
  users,
  type Role,
} from "../db/schema";
import { assertCan, type Actor } from "../authz";
import { logActivity, userActor } from "../activity";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { hashPassword, randomToken, sha256 } from "../security/crypto";
import { queueEmail } from "../email";
import { button, layout, paragraph } from "../email/templates";
import { env } from "../env";
import { isValidEmail, normalizeEmail } from "@/lib/text";
import { ROLE_LABELS } from "@/lib/permissions";
import { monthlyUsage } from "./usage";
import { creditBalance } from "./reports";

export const INVITE_TTL_MS = 7 * 86400_000;

/* ---------------- Clients ---------------- */

export const clientSchema = z.object({ name: z.string().trim().min(1).max(120), contactName: z.string().trim().max(120).nullish(), contactEmail: z.string().trim().email().nullish().or(z.literal("").transform(() => null)), notes: z.string().max(2000).nullish() });

export async function listClients(actor: Actor) {
  const rows = await db.select().from(clients).where(eq(clients.orgId, actor.orgId)).orderBy(clients.name);
  const visible = actor.clientIds === null ? rows : rows.filter((c) => actor.clientIds!.includes(c.id));
  const counts = visible.length ? await db.select({ clientId: businessLocations.clientId, n: count() }).from(businessLocations).where(and(eq(businessLocations.orgId, actor.orgId), inArray(businessLocations.clientId, visible.map((v) => v.id)), eq(businessLocations.status, "active"))).groupBy(businessLocations.clientId) : [];
  return visible.map((c) => ({ ...c, businesses: counts.find((x) => x.clientId === c.id)?.n ?? 0 }));
}

export async function saveClient(actor: Actor, raw: unknown, id?: string) {
  assertCan(actor, "clients.manage");
  const input = clientSchema.parse(raw);
  if (id) {
    const [c] = await db.update(clients).set({ ...input, updatedAt: new Date() }).where(and(eq(clients.id, id), eq(clients.orgId, actor.orgId))).returning();
    if (!c) throw notFound("Client");
    return c;
  }
  const [c] = await db.insert(clients).values({ ...input, orgId: actor.orgId }).returning();
  await logActivity({ orgId: actor.orgId, actor: userActor(actor.userId), action: "client.created", target: { type: "client", id: c.id } });
  return c;
}

/** Offboarding pauses every automation for the client's businesses and archives them; data is retained. */
export async function offboardClient(actor: Actor, clientId: string) {
  assertCan(actor, "clients.manage");
  const [c] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.orgId, actor.orgId))).limit(1);
  if (!c) throw notFound("Client");
  const biz = await db.select({ id: businessLocations.id }).from(businessLocations).where(eq(businessLocations.clientId, clientId));
  if (biz.length) {
    await db.update(automationRules).set({ enabled: false, nextRunAt: null }).where(inArray(automationRules.businessId, biz.map((b) => b.id)));
    await db.update(businessLocations).set({ status: "archived" }).where(inArray(businessLocations.id, biz.map((b) => b.id)));
    await db.update(tasks).set({ status: "cancelled", resolvedBy: "system", resolutionNote: "Client offboarded" }).where(and(inArray(tasks.businessId, biz.map((b) => b.id)), eq(tasks.status, "open")));
  }
  await db.update(clients).set({ status: "offboarded", offboardedAt: new Date() }).where(eq(clients.id, clientId));
  await logActivity({ orgId: actor.orgId, actor: userActor(actor.userId), action: "client.offboarded", target: { type: "client", id: clientId }, detail: { businesses: biz.length } });
}

/**
 * Signals that a client may need attention: unresolved tasks, failing
 * automations, broken connections and lack of recent activity. These are
 * prompts for an account manager, not predictions.
 */
export async function clientHealth(actor: Actor) {
  assertCan(actor, "clients.manage");
  const biz = await db.select().from(businessLocations).where(and(eq(businessLocations.orgId, actor.orgId), eq(businessLocations.status, "active")));
  if (!biz.length) return [];
  const ids = biz.map((b) => b.id);
  const since = new Date(Date.now() - 30 * 86400_000);
  const overdue = await db.select({ b: tasks.businessId, n: count() }).from(tasks).where(and(inArray(tasks.businessId, ids), eq(tasks.status, "open"), sql`${tasks.createdAt} < now() - interval '7 days'`)).groupBy(tasks.businessId);
  const failing = await db.select({ b: automationRules.businessId, n: count() }).from(automationRules).where(and(inArray(automationRules.businessId, ids), eq(automationRules.enabled, true), sql`${automationRules.consecutiveFailures} >= 2`)).groupBy(automationRules.businessId);
  const enabled = await db.select({ b: automationRules.businessId, n: count() }).from(automationRules).where(and(inArray(automationRules.businessId, ids), eq(automationRules.enabled, true))).groupBy(automationRules.businessId);
  const lastLogin = await db.execute<{ business_id: string; last: Date | null }>(sql`
    select b.id as business_id, max(u.last_login_at) as last from business_locations b
    join memberships m on m.org_id = b.org_id and m.status = 'active' and (m.client_ids is null or b.client_id = any(m.client_ids))
    join users u on u.id = m.user_id where b.id in ${ids} and m.role = 'client_approver' group by b.id`);
  const activity = await db.select({ b: activityEvents.businessId, n: count() }).from(activityEvents).where(and(inArray(activityEvents.businessId, ids), gte(activityEvents.createdAt, since), eq(activityEvents.actorType, "user"))).groupBy(activityEvents.businessId);
  const broken = await db.select({ id: integrations.id, status: integrations.status }).from(integrations).where(and(eq(integrations.orgId, actor.orgId), inArray(integrations.status, ["expired", "error"])));
  return biz.map((b) => {
    const signals: string[] = [];
    const o = overdue.find((x) => x.b === b.id)?.n ?? 0;
    if (o) signals.push(`${o} task(s) open for more than 7 days`);
    const f = failing.find((x) => x.b === b.id)?.n ?? 0;
    if (f) signals.push(`${f} automation(s) failing repeatedly`);
    if (!(enabled.find((x) => x.b === b.id)?.n ?? 0)) signals.push("No automations enabled");
    if (b.googleIntegrationId && broken.some((x) => x.id === b.googleIntegrationId)) signals.push("Google connection needs reconnecting");
    if (!b.gbpLocationName) signals.push("Google Business Profile not connected");
    const ll = (lastLogin.rows as { business_id: string; last: Date | null }[]).find((x) => x.business_id === b.id);
    if (ll && (!ll.last || new Date(ll.last) < since)) signals.push("Client approver has not signed in for 30 days");
    if (!(activity.find((x) => x.b === b.id)?.n ?? 0)) signals.push("No team activity in 30 days");
    return { businessId: b.id, name: b.name, clientId: b.clientId, signals, level: signals.length >= 3 ? "high" : signals.length ? "medium" : "ok" };
  });
}

/* ---------------- Members and invitations ---------------- */

export async function listMembers(actor: Actor) {
  assertCan(actor, "members.manage");
  const rows = await db.select({ m: memberships, u: { id: users.id, name: users.name, email: users.email, lastLoginAt: users.lastLoginAt } }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, actor.orgId)).orderBy(users.name);
  const invites = await db.select().from(invitations).where(and(eq(invitations.orgId, actor.orgId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).orderBy(desc(invitations.createdAt));
  return { members: rows, invitations: invites };
}

function canGrant(actor: Actor, role: Role) {
  if (role === "owner") return actor.role === "owner";
  return actor.role === "owner" || actor.role === "admin";
}

export async function inviteMember(actor: Actor, input: { email: string; role: Role; clientIds?: string[] | null }) {
  assertCan(actor, "members.manage");
  if (!ROLES.includes(input.role)) throw invalid("Unknown role");
  if (!canGrant(actor, input.role)) throw forbidden("Only owners can invite owners");
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw invalid("Enter a valid email");
  const clientIds = input.clientIds?.length ? input.clientIds : null;
  if (input.role === "client_approver" && !clientIds) throw invalid("Client approvers must be limited to at least one client");
  if (clientIds) {
    const found = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.orgId, actor.orgId), inArray(clients.id, clientIds)));
    if (found.length !== clientIds.length) throw invalid("Unknown client");
  }
  const [existing] = await db.select({ m: memberships }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, actor.orgId), sql`lower(${users.email}) = ${email}`)).limit(1);
  if (existing) throw invalid("That person is already a member");
  const token = randomToken(32);
  await db.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.orgId, actor.orgId), eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  const [inv] = await db.insert(invitations).values({ orgId: actor.orgId, email, role: input.role, clientIds, tokenHash: sha256(token), invitedByUserId: actor.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) }).returning();
  const url = `${env().APP_URL.replace(/\/$/, "")}/invite/${token}`;
  const [brand] = await db.select().from(organizationBranding).where(eq(organizationBranding.orgId, actor.orgId)).limit(1);
  const name = brand?.displayName ?? actor.orgName;
  const color = brand?.primaryColor ?? "#2563eb";
  await queueEmail({ orgId: actor.orgId, to: email, subject: `${actor.name} invited you to ${name}`, html: layout({ name, color, logoUrl: brand?.logoUrl }, `Join ${name}`, paragraph(`${actor.name} invited you as ${ROLE_LABELS[input.role]}.`) + button(url, "Accept invitation", color) + paragraph("This invitation expires in 7 days.")), text: `Accept the invitation: ${url}`, template: "invitation", related: { type: "invitation", id: inv.id } });
  await logActivity({ orgId: actor.orgId, actor: userActor(actor.userId), action: "member.invited", target: { type: "invitation", id: inv.id }, detail: { email, role: input.role } });
  return { invitation: inv, url };
}

export async function revokeInvitation(actor: Actor, id: string) {
  assertCan(actor, "members.manage");
  await db.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.id, id), eq(invitations.orgId, actor.orgId)));
}

export async function lookupInvitation(token: string) {
  const [inv] = await db.select({ i: invitations, orgName: organizations.name }).from(invitations).innerJoin(organizations, eq(organizations.id, invitations.orgId)).where(eq(invitations.tokenHash, sha256(token))).limit(1);
  if (!inv) return { state: "invalid" as const };
  if (inv.i.revokedAt) return { state: "revoked" as const };
  if (inv.i.acceptedAt) return { state: "used" as const };
  if (inv.i.expiresAt < new Date()) return { state: "expired" as const };
  const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${inv.i.email}`).limit(1);
  return { state: "valid" as const, invitation: inv.i, orgName: inv.orgName, hasAccount: Boolean(u) };
}

/** Accepts an invitation. An existing account must be signed in as the invited email. */
export async function acceptInvitation(token: string, opts: { signedInUserId?: string | null; name?: string; password?: string }) {
  const res = await db.transaction(async (tx) => {
    const [inv] = await tx.update(invitations).set({ acceptedAt: new Date() }).where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gte(invitations.expiresAt, new Date()))).returning();
    if (!inv) throw new AppError("This invitation is no longer valid", "invalid");
    let [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${inv.email}`).limit(1);
    if (u) {
      if (opts.signedInUserId !== u.id) throw new AppError("Sign in as the invited email address to accept this invitation", "forbidden");
    } else {
      if (!opts.name?.trim() || !opts.password || opts.password.length < 10) throw invalid("Enter your name and a password of at least 10 characters");
      [u] = await tx.insert(users).values({ email: inv.email, name: opts.name.trim(), passwordHash: await hashPassword(opts.password), emailVerifiedAt: new Date() }).returning();
    }
    await tx.insert(memberships).values({ orgId: inv.orgId, userId: u.id, role: inv.role, clientIds: inv.clientIds }).onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { role: inv.role, clientIds: inv.clientIds, status: "active", updatedAt: new Date() } });
    return { userId: u.id, orgId: inv.orgId, invitationId: inv.id };
  });
  await logActivity({ orgId: res.orgId, actor: userActor(res.userId), action: "member.joined", target: { type: "invitation", id: res.invitationId } });
  return res;
}

export async function updateMember(actor: Actor, membershipId: string, patch: { role?: Role; clientIds?: string[] | null; status?: "active" | "deactivated" }) {
  assertCan(actor, "members.manage");
  const [m] = await db.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.orgId, actor.orgId))).limit(1);
  if (!m) throw notFound("Member");
  if (m.userId === actor.userId && (patch.role || patch.status)) throw invalid("You cannot change your own role or deactivate yourself");
  if ((m.role === "owner" || patch.role === "owner") && actor.role !== "owner") throw forbidden("Only owners can change owners");
  if (m.role === "owner" && (patch.role && patch.role !== "owner" || patch.status === "deactivated")) {
    const [{ n }] = await db.select({ n: count() }).from(memberships).where(and(eq(memberships.orgId, actor.orgId), eq(memberships.role, "owner"), eq(memberships.status, "active")));
    if (n <= 1) throw invalid("An organization needs at least one active owner");
  }
  const role = patch.role ?? m.role;
  const clientIds = patch.clientIds === undefined ? m.clientIds : patch.clientIds?.length ? patch.clientIds : null;
  if (role === "client_approver" && !clientIds?.length) throw invalid("Client approvers must be limited to at least one client");
  const [u] = await db.update(memberships).set({ role, clientIds, status: patch.status ?? m.status, updatedAt: new Date() }).where(eq(memberships.id, m.id)).returning();
  await logActivity({ orgId: actor.orgId, actor: userActor(actor.userId), action: "member.updated", target: { type: "membership", id: m.id }, detail: patch });
  return u;
}

/* ---------------- White-label branding ---------------- */

export const brandingSchema = z.object({
  displayName: z.string().trim().max(80).nullish(),
  logoUrl: z.string().url().max(500).nullish().or(z.literal("").transform(() => null)),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  supportEmail: z.string().email().nullish().or(z.literal("").transform(() => null)),
  supportUrl: z.string().url().nullish().or(z.literal("").transform(() => null)),
  senderName: z.string().trim().max(80).nullish(),
  senderEmail: z.string().email().nullish().or(z.literal("").transform(() => null)),
  reportFooter: z.string().max(300).nullish(),
});

export async function getBranding(orgId: string) {
  const [b] = await db.select().from(organizationBranding).where(eq(organizationBranding.orgId, orgId)).limit(1);
  return b ?? null;
}

export async function saveBranding(actor: Actor, raw: unknown) {
  assertCan(actor, "org.manage");
  const input = brandingSchema.parse(raw);
  const current = await getBranding(actor.orgId);
  // Changing the sender address requires verifying it again before it is used.
  const senderChanged = (input.senderEmail ?? null) !== (current?.senderEmail ?? null);
  const values = { ...input, senderVerifiedAt: senderChanged ? null : (current?.senderVerifiedAt ?? null), updatedAt: new Date() };
  const [b] = await db.insert(organizationBranding).values({ orgId: actor.orgId, ...values }).onConflictDoUpdate({ target: organizationBranding.orgId, set: values }).returning();
  await logActivity({ orgId: actor.orgId, actor: userActor(actor.userId), action: "branding.updated" });
  return b;
}

/**
 * Sender verification: in a real deployment the sending domain must also pass
 * SPF/DKIM with the SMTP provider. This records that an owner confirmed it.
 */
export async function markSenderVerified(actor: Actor) {
  assertCan(actor, "org.manage");
  const b = await getBranding(actor.orgId);
  if (!b?.senderEmail) throw invalid("Set a sender email first");
  await db.update(organizationBranding).set({ senderVerifiedAt: new Date() }).where(eq(organizationBranding.orgId, actor.orgId));
}

/* ---------------- Org overview ---------------- */

export async function orgOverview(actor: Actor) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, actor.orgId)).limit(1);
  const usage = await monthlyUsage(actor.orgId);
  const credits = await creditBalance(actor.orgId);
  const [{ n: businesses }] = await db.select({ n: count() }).from(businessLocations).where(and(eq(businessLocations.orgId, actor.orgId), eq(businessLocations.status, "active")));
  return { org, usage, credits, businesses };
}

export async function updateOrg(actor: Actor, patch: { name?: string; kind?: "agency" | "business" }) {
  assertCan(actor, "org.manage");
  const [o] = await db.update(organizations).set({ name: patch.name?.trim() || undefined, kind: patch.kind, updatedAt: new Date() }).where(eq(organizations.id, actor.orgId)).returning();
  return o;
}

export async function activityLog(actor: Actor, filters: { businessId?: string; limit?: number } = {}) {
  assertCan(actor, "members.manage");
  const conds = [eq(activityEvents.orgId, actor.orgId)];
  if (filters.businessId) conds.push(eq(activityEvents.businessId, filters.businessId));
  return db
    .select({ e: activityEvents, userName: users.name })
    .from(activityEvents)
    .leftJoin(users, sql`${users.id}::text = ${activityEvents.actorId}`)
    .where(and(...conds))
    .orderBy(desc(activityEvents.createdAt))
    .limit(filters.limit ?? 200);
}
