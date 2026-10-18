import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { memberships, organizations, sessions, users } from "../db/schema";
import { hashPassword, randomToken, sha256, verifyPassword } from "../security/crypto";
import { AppError, invalid } from "../errors";
import { isValidEmail, normalizeEmail, slugify } from "@/lib/text";

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export async function createSessionRecord(userId: string, orgId: string | null, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomToken(32);
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    activeOrgId: orgId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export async function lookupSession(token: string) {
  const [row] = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.u.deactivatedAt) return null;
  return row;
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function setSessionOrg(token: string, orgId: string) {
  await db.update(sessions).set({ activeOrgId: orgId }).where(eq(sessions.id, sha256(token)));
}

export async function uniqueOrgSlug(name: string) {
  const base = slugify(name, 40);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [exists] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (!exists) return slug;
  }
  return `${base}-${randomToken(4).toLowerCase()}`;
}

export async function signUp(input: { name: string; email: string; password: string; orgName: string; orgKind: "agency" | "business" }) {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw invalid("Enter a valid email address");
  if (input.password.length < 10) throw invalid("Password must be at least 10 characters");
  if (!input.name.trim() || !input.orgName.trim()) throw invalid("Name and organization name are required");
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (existing) throw new AppError("An account with this email already exists", "conflict");
  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueOrgSlug(input.orgName);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email, name: input.name.trim(), passwordHash }).returning();
    const [org] = await tx.insert(organizations).values({ name: input.orgName.trim(), slug, kind: input.orgKind }).returning();
    await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
    return { user, org };
  });
}

export async function authenticate(emailRaw: string, password: string) {
  const email = normalizeEmail(emailRaw);
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  const ok = await verifyPassword(password, user?.passwordHash ?? "scrypt$16384$AAAA$AAAA");
  if (!user || !ok) throw invalid("Email or password is incorrect");
  if (user.deactivatedAt) throw invalid("This account has been deactivated");
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const [m] = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, "active")))
    .orderBy(memberships.createdAt)
    .limit(1);
  return { user, orgId: m?.orgId ?? null };
}

export async function updateProfileName(userId: string, name: string) {
  const n = name.trim();
  if (!n || n.length > 120) throw invalid("Enter your name");
  await db.update(users).set({ name: n }).where(eq(users.id, userId));
}

/** Changes the password and signs out every other session. */
export async function changePassword(userId: string, currentSessionToken: string, current: string, next: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !(await verifyPassword(current, u.passwordHash))) throw invalid("Your current password is incorrect");
  if (next.length < 10) throw invalid("The new password must be at least 10 characters");
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  await db.delete(sessions).where(and(eq(sessions.userId, userId), sql`${sessions.id} <> ${sha256(currentSessionToken)}`));
}
