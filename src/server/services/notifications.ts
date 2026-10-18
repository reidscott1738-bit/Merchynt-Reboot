import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { businessLocations, memberships, notificationPreferences, notifications, users, type NotificationPrefs } from "../db/schema";
import { queueEmail } from "../email";
import { button, layout, paragraph } from "../email/templates";
import { env } from "../env";
import { toLocalParts } from "@/lib/time";

export const NOTIFICATION_TYPES: { key: string; label: string; defaultEmail: boolean }[] = [
  { key: "task", label: "New approval tasks", defaultEmail: false },
  { key: "failure", label: "Failed automations and publications", defaultEmail: true },
  { key: "integration", label: "Disconnected or expiring accounts", defaultEmail: true },
  { key: "review", label: "New negative reviews", defaultEmail: true },
  { key: "report", label: "Reports ready", defaultEmail: false },
  { key: "audit", label: "Audits completed", defaultEmail: false },
  { key: "reminder", label: "Account manager reminders", defaultEmail: true },
];

export function defaultPrefs(): NotificationPrefs {
  return { channels: Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.key, { email: t.defaultEmail, inApp: true }])), digest: "immediate" };
}

function category(type: string) {
  return type.split(".")[0];
}

function inQuietHours(prefs: NotificationPrefs, now = new Date()) {
  if (!prefs.quietHours) return false;
  const p = toLocalParts(now, prefs.quietHours.timezone);
  const cur = p.hour * 60 + p.minute;
  const [sh, sm] = prefs.quietHours.start.split(":").map(Number);
  const [eh, em] = prefs.quietHours.end.split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

/**
 * Sends an in-app notification (and email when the user's preferences allow)
 * to org members who can see the business. Triggered only by explicit system
 * events, never by model output.
 */
export async function notifyOrgUsers(orgId: string, businessId: string | null, n: { type: string; title: string; body?: string; link?: string }, tx: DbOrTx = db) {
  let clientId: string | null = null;
  if (businessId) {
    const [b] = await tx.select({ clientId: businessLocations.clientId }).from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
    clientId = b?.clientId ?? null;
  }
  const members = await tx
    .select({ userId: memberships.userId, role: memberships.role, clientIds: memberships.clientIds, email: users.email, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active"), isNull(users.deactivatedAt)));
  const prefsRows = members.length
    ? await tx.select().from(notificationPreferences).where(and(eq(notificationPreferences.orgId, orgId), inArray(notificationPreferences.userId, members.map((m) => m.userId))))
    : [];
  const prefsBy = new Map(prefsRows.map((p) => [p.userId, p.prefs]));
  const cat = category(n.type);
  for (const m of members) {
    const scoped = m.clientIds && m.clientIds.length ? m.clientIds : m.role === "client_approver" ? [] : null;
    if (scoped !== null && (!clientId || !scoped.includes(clientId))) continue;
    // Client approvers only hear about tasks and reports.
    if (m.role === "client_approver" && !["task", "report"].includes(cat)) continue;
    const prefs = prefsBy.get(m.userId) ?? defaultPrefs();
    const ch = prefs.channels[cat] ?? { email: false, inApp: true };
    if (ch.inApp) await tx.insert(notifications).values({ orgId, userId: m.userId, businessId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null });
    if (ch.email && !inQuietHours(prefs) && prefs.digest === "immediate") {
      const url = n.link ? `${env().APP_URL.replace(/\/$/, "")}${n.link}` : env().APP_URL;
      await queueEmail(
        {
          orgId,
          to: m.email,
          subject: n.title,
          html: layout({ name: env().APP_NAME, color: "#2563eb" }, n.title, paragraph(n.body ?? "") + button(url, "Open", "#2563eb")),
          text: `${n.title}\n\n${n.body ?? ""}\n\n${url}`,
          template: `notification.${n.type}`,
        },
        tx,
      );
    }
  }
}

export async function listNotifications(userId: string, orgId: string, limit = 30) {
  return db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.orgId, orgId))).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function unreadCount(userId: string, orgId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.orgId, orgId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function markAllRead(userId: string, orgId: string) {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), eq(notifications.orgId, orgId), isNull(notifications.readAt)));
}

export async function getPrefs(userId: string, orgId: string): Promise<NotificationPrefs> {
  const [p] = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.orgId, orgId))).limit(1);
  return p?.prefs ?? defaultPrefs();
}

export async function savePrefs(userId: string, orgId: string, prefs: NotificationPrefs) {
  await db
    .insert(notificationPreferences)
    .values({ userId, orgId, prefs })
    .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.orgId], set: { prefs, updatedAt: new Date() } });
}
