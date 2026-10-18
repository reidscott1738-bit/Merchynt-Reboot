import { and, desc, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { approvalTokens, businessLocations, memberships, organizationBranding, taskEvents, tasks, users, type TaskStatus, type TaskType } from "../db/schema";
import { nextTaskStatus, type TaskAction } from "@/lib/approval-policy";
import { can } from "@/lib/permissions";
import { randomToken, sha256 } from "../security/crypto";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { logActivity } from "../activity";
import type { Actor } from "../authz";
import { queueEmail } from "../email";
import { button, layout, paragraph, quote } from "../email/templates";
import { env } from "../env";
import { notifyOrgUsers } from "./notifications";

export type TaskRow = typeof tasks.$inferSelect;

/**
 * Module handlers run the workflow that follows a task decision. Approval and
 * auto-publish paths both end in the same handler code so outcomes are
 * recorded identically.
 */
export type TaskHandler = {
  /** Text shown on approval pages and emails. */
  preview(task: TaskRow): Promise<{ title: string; body: string; imageUrl?: string | null; meta?: Record<string, string> }>;
  onApprove(task: TaskRow, ctx: { actorLabel: string; edits?: { body?: string } }): Promise<Record<string, unknown>>;
  onReject?(task: TaskRow, ctx: { actorLabel: string; reason?: string }): Promise<void>;
  onSkip?(task: TaskRow, ctx: { actorLabel: string }): Promise<void>;
  onEdit?(task: TaskRow, edits: { body?: string }): Promise<void>;
  editable?: boolean;
};

const handlers = new Map<string, TaskHandler>();
export function registerTaskHandler(refType: string, h: TaskHandler) {
  handlers.set(refType, h);
}
function handlerFor(refType: string): TaskHandler {
  const h = handlers.get(refType);
  if (!h) throw new Error(`No task handler registered for ${refType}`);
  return h;
}
export function hasTaskHandler(refType: string) {
  return handlers.has(refType);
}

export type CreateTaskInput = {
  orgId: string;
  businessId: string;
  type: TaskType;
  title: string;
  summary?: string;
  refType: string;
  refId: string;
  kind?: "approval" | "action";
  dueAt?: Date | null;
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
  notificationRecipients?: string[];
  visibleInDashboard?: boolean;
  createdBy?: string;
  sendEmails?: boolean;
};

/** Creates (or returns the existing open) task for a ref, and notifies recipients. */
export async function createTask(input: CreateTaskInput, tx: DbOrTx = db): Promise<TaskRow> {
  const [existing] = await tx.select().from(tasks).where(and(eq(tasks.refType, input.refType), eq(tasks.refId, input.refId), eq(tasks.status, "open"))).limit(1);
  if (existing) return existing;
  const [task] = await tx
    .insert(tasks)
    .values({
      orgId: input.orgId,
      businessId: input.businessId,
      type: input.type,
      title: input.title,
      summary: input.summary ?? null,
      refType: input.refType,
      refId: input.refId,
      kind: input.kind ?? "approval",
      dueAt: input.dueAt ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      assigneeEmail: input.assigneeEmail ?? null,
      notificationRecipients: input.notificationRecipients ?? [],
      visibleInDashboard: input.visibleInDashboard ?? true,
      createdBy: input.createdBy ?? "system",
    })
    .onConflictDoNothing()
    .returning();
  if (!task) {
    const [again] = await tx.select().from(tasks).where(and(eq(tasks.refType, input.refType), eq(tasks.refId, input.refId), eq(tasks.status, "open"))).limit(1);
    return again;
  }
  await tx.insert(taskEvents).values({ taskId: task.id, action: "created", actorType: input.createdBy && input.createdBy !== "system" ? "user" : "system", actorId: input.createdBy ?? null });
  if (input.sendEmails !== false) await sendTaskNotifications(task, tx);
  return task;
}

/** Notifications never approve anything; the email links to a page with explicit buttons. */
export async function sendTaskNotifications(task: TaskRow, tx: DbOrTx = db) {
  const recipients = new Set(task.notificationRecipients.map((r) => r.toLowerCase()));
  if (task.assigneeEmail) recipients.add(task.assigneeEmail.toLowerCase());
  if (task.kind === "approval") {
    for (const email of recipients) {
      const token = await issueApprovalToken(task.id, email, handlers.get(task.refType)?.editable ? ["approve", "skip", "reject", "edit"] : ["approve", "skip", "reject"], tx);
      await sendApprovalEmail(task, email, token, tx);
    }
  }
  if (task.visibleInDashboard) {
    await notifyOrgUsers(task.orgId, task.businessId, { type: `task.${task.type}`, title: task.title, body: task.summary ?? undefined, link: `/tasks/${task.id}` }, tx);
  }
}

async function sendApprovalEmail(task: TaskRow, email: string, token: string, tx: DbOrTx) {
  const [b] = await tx.select().from(businessLocations).where(eq(businessLocations.id, task.businessId)).limit(1);
  const [brand] = await tx.select().from(organizationBranding).where(eq(organizationBranding.orgId, task.orgId)).limit(1);
  const brandInfo = { name: brand?.displayName ?? env().APP_NAME, color: brand?.primaryColor ?? "#2563eb", logoUrl: brand?.logoUrl, footer: brand?.reportFooter };
  let previewText = task.summary ?? "";
  try {
    const p = await handlerFor(task.refType).preview(task);
    previewText = p.body;
  } catch {
    /* preview is best-effort in email */
  }
  const url = `${env().APP_URL.replace(/\/$/, "")}/approve/${token}`;
  const html = layout(
    brandInfo,
    task.title,
    paragraph(`${b?.name ?? "A business"} has content waiting for your review.`) +
      (previewText ? quote(previewText.slice(0, 800)) : "") +
      paragraph("Opening this email does not approve anything. Use the button to review, edit, approve or skip.") +
      button(url, "Review", brandInfo.color) +
      paragraph(task.dueAt ? `Due ${task.dueAt.toUTCString()}.` : ""),
  );
  await queueEmail(
    { orgId: task.orgId, to: email, subject: `Approval needed: ${task.title}`, html, text: `${task.title}\n\n${previewText}\n\nReview: ${url}`, template: "task_approval", related: { type: "task", id: task.id } },
    tx,
  );
}

export const APPROVAL_TOKEN_TTL_MS = 14 * 24 * 3600 * 1000;

export async function issueApprovalToken(taskId: string, recipientEmail: string, actions: string[], tx: DbOrTx = db) {
  const token = randomToken(32);
  await tx.insert(approvalTokens).values({ taskId, tokenHash: sha256(token), recipientEmail: recipientEmail.toLowerCase(), allowedActions: actions, expiresAt: new Date(Date.now() + APPROVAL_TOKEN_TTL_MS) });
  return token;
}

/** Read-only lookup for the approval page. Never changes state. */
export async function inspectApprovalToken(token: string) {
  const [row] = await db
    .select({ t: approvalTokens, task: tasks })
    .from(approvalTokens)
    .innerJoin(tasks, eq(tasks.id, approvalTokens.taskId))
    .where(eq(approvalTokens.tokenHash, sha256(token)))
    .limit(1);
  if (!row) return { state: "invalid" as const };
  if (row.t.revokedAt) return { state: "revoked" as const };
  if (row.t.usedAt) return { state: "used" as const, task: row.task };
  if (row.t.expiresAt < new Date()) return { state: "expired" as const };
  if (row.task.status !== "open") return { state: "resolved" as const, task: row.task };
  const preview = await handlerFor(row.task.refType).preview(row.task);
  return { state: "valid" as const, task: row.task, token: row.t, preview, editable: Boolean(handlers.get(row.task.refType)?.editable) && row.t.allowedActions.includes("edit") };
}

/**
 * Consumes a single-use approval token. The token is marked used inside the
 * same transaction that claims it, so a replayed link cannot act twice.
 */
export async function actWithApprovalToken(token: string, action: "approve" | "reject" | "skip", edits?: { body?: string }, reason?: string) {
  const claimed = await db
    .update(approvalTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(approvalTokens.tokenHash, sha256(token)), isNull(approvalTokens.usedAt), isNull(approvalTokens.revokedAt), gt(approvalTokens.expiresAt, new Date())))
    .returning();
  const t = claimed[0];
  if (!t) throw new AppError("This approval link is no longer valid. It may have expired or already been used.", "invalid");
  if (!t.allowedActions.includes(action) || (edits?.body && !t.allowedActions.includes("edit"))) {
    await db.update(approvalTokens).set({ usedAt: null }).where(eq(approvalTokens.id, t.id));
    throw forbidden("This link does not allow that action");
  }
  let result: Awaited<ReturnType<typeof applyTaskAction>>;
  try {
    result = await applyTaskAction(t.taskId, action, { actorType: "approval_link", actorId: t.recipientEmail, actorLabel: t.recipientEmail }, { edits, reason });
  } catch (e) {
    // The task did not change, so the link stays usable for a corrected attempt.
    if (e instanceof AppError && e.code === "invalid") await db.update(approvalTokens).set({ usedAt: null }).where(eq(approvalTokens.id, t.id));
    throw e;
  }
  // Other outstanding links for the same task become useless once it is resolved.
  await db.update(approvalTokens).set({ revokedAt: new Date() }).where(and(eq(approvalTokens.taskId, t.taskId), isNull(approvalTokens.usedAt), isNull(approvalTokens.revokedAt)));
  return result;
}

export async function revokeApprovalTokens(taskId: string) {
  await db.update(approvalTokens).set({ revokedAt: new Date() }).where(and(eq(approvalTokens.taskId, taskId), isNull(approvalTokens.usedAt), isNull(approvalTokens.revokedAt)));
}

type ActionActor = { actorType: "user" | "approval_link" | "system"; actorId: string | null; actorLabel: string };

/**
 * The single path for resolving tasks. Claims the task row with a conditional
 * update so concurrent approvals cannot both run the publish workflow.
 */
export async function applyTaskAction(taskId: string, action: TaskAction, actor: ActionActor, opts: { edits?: { body?: string }; reason?: string } = {}) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw notFound("Task");
  const handler = handlerFor(task.refType);

  if (action === "edit") {
    if (task.status !== "open") throw invalid("Only open tasks can be edited");
    if (!handler.onEdit) throw invalid("This task cannot be edited");
    await handler.onEdit(task, opts.edits ?? {});
    await db.insert(taskEvents).values({ taskId, action: "edited", actorType: actor.actorType, actorId: actor.actorId, detail: { length: opts.edits?.body?.length ?? 0 } });
    return { task, status: task.status };
  }

  const next = nextTaskStatus(task.status, action);
  if (!next) throw invalid(`Cannot ${action} a task that is ${task.status}`);
  const [claimed] = await db
    .update(tasks)
    .set({ status: next, resolvedAt: new Date(), resolvedBy: actor.actorLabel, resolutionNote: opts.reason ?? null, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, task.status)))
    .returning();
  if (!claimed) throw new AppError("This task was already handled by someone else", "conflict");
  await db.insert(taskEvents).values({ taskId, action, actorType: actor.actorType, actorId: actor.actorId, detail: opts.reason ? { reason: opts.reason } : null });
  await logActivity({ orgId: task.orgId, businessId: task.businessId, actor: { type: actor.actorType, id: actor.actorId }, action: `task.${action}`, target: { type: "task", id: task.id }, detail: { refType: task.refType, refId: task.refId } });

  let outcome: Record<string, unknown> = {};
  try {
    if (action === "approve") {
      if (opts.edits?.body && handler.onEdit) await handler.onEdit(task, opts.edits);
      outcome = await handler.onApprove(claimed, { actorLabel: actor.actorLabel, edits: opts.edits });
    } else if (action === "reject") await handler.onReject?.(claimed, { actorLabel: actor.actorLabel, reason: opts.reason });
    else if (action === "skip") await handler.onSkip?.(claimed, { actorLabel: actor.actorLabel });
  } catch (e) {
    outcome = { error: (e as Error).message };
    // A precondition failure (e.g. content still fails validation) leaves the task open so a person can fix it.
    const precondition = e instanceof AppError && e.code === "invalid";
    await db.insert(taskEvents).values({ taskId, action: precondition ? "reopened_after_failed_precondition" : "workflow_failed", actorType: "system", detail: { error: (e as Error).message } });
    await db
      .update(tasks)
      .set(precondition ? { status: task.status, resolvedAt: null, resolvedBy: null, outcome, updatedAt: new Date() } : { outcome, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    throw e;
  }
  await db.update(tasks).set({ outcome, updatedAt: new Date() }).where(eq(tasks.id, taskId));
  if (action !== "approve") await revokeApprovalTokens(taskId);
  return { task: claimed, status: next, outcome };
}

/** Dashboard action: verifies the actor can resolve this task. */
export async function actOnTaskAsUser(actor: Actor, taskId: string, action: TaskAction, opts: { edits?: { body?: string }; reason?: string } = {}) {
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId))).limit(1);
  if (!task) throw notFound("Task");
  if (actor.clientIds !== null) {
    const [b] = await db.select({ clientId: businessLocations.clientId }).from(businessLocations).where(eq(businessLocations.id, task.businessId)).limit(1);
    if (!b?.clientId || !actor.clientIds.includes(b.clientId)) throw notFound("Task");
    if (!task.clientCanApprove) throw forbidden("Client approval is not enabled for this task");
  }
  if (!can(actor.role, "content.approve")) throw forbidden();
  return applyTaskAction(taskId, action, { actorType: "user", actorId: actor.userId, actorLabel: actor.name }, opts);
}

export async function completeTaskForRef(refType: string, refId: string, outcome: Record<string, unknown>, status: TaskStatus = "completed") {
  await db.update(tasks).set({ status, resolvedAt: new Date(), resolvedBy: "system", outcome, updatedAt: new Date() }).where(and(eq(tasks.refType, refType), eq(tasks.refId, refId), eq(tasks.status, "open")));
}

export async function recordTaskOutcome(refType: string, refId: string, outcome: Record<string, unknown>) {
  const rows = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.refType, refType), eq(tasks.refId, refId))).orderBy(desc(tasks.createdAt)).limit(1);
  if (rows[0]) {
    await db.update(tasks).set({ outcome, updatedAt: new Date() }).where(eq(tasks.id, rows[0].id));
    await db.insert(taskEvents).values({ taskId: rows[0].id, action: "outcome", actorType: "system", detail: outcome });
  }
}

export type TaskFilters = { businessId?: string; status?: TaskStatus | "all"; type?: TaskType | "all"; assignee?: "me" | "all"; q?: string };

export async function listTasks(actor: Actor, f: TaskFilters, limit = 100) {
  const conds: SQL[] = [eq(tasks.orgId, actor.orgId)];
  if (f.businessId) conds.push(eq(tasks.businessId, f.businessId));
  if (f.status && f.status !== "all") conds.push(eq(tasks.status, f.status));
  if (f.type && f.type !== "all") conds.push(eq(tasks.type, f.type));
  if (f.assignee === "me") conds.push(sql`(${tasks.assigneeUserId} = ${actor.userId} or lower(${tasks.assigneeEmail}) = ${actor.email.toLowerCase()})`);
  if (f.q) conds.push(sql`${tasks.title} ilike ${"%" + f.q.replace(/[%_]/g, "") + "%"}`);
  if (actor.clientIds !== null) {
    if (actor.clientIds.length === 0) return [];
    conds.push(inArray(businessLocations.clientId, actor.clientIds));
  }
  const rows = await db
    .select({ task: tasks, businessName: businessLocations.name })
    .from(tasks)
    .innerJoin(businessLocations, eq(businessLocations.id, tasks.businessId))
    .where(and(...conds, actor.clientIds !== null ? undefined : sql`true`, f.assignee === "me" ? undefined : eq(tasks.visibleInDashboard, true)))
    .orderBy(sql`case when ${tasks.status} = 'open' then 0 else 1 end`, sql`${tasks.dueAt} asc nulls last`, desc(tasks.createdAt))
    .limit(limit);
  return rows;
}

export async function getTaskDetail(actor: Actor, taskId: string) {
  const [row] = await db
    .select({ task: tasks, business: businessLocations })
    .from(tasks)
    .innerJoin(businessLocations, eq(businessLocations.id, tasks.businessId))
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId)))
    .limit(1);
  if (!row) throw notFound("Task");
  if (actor.clientIds !== null && (!row.business.clientId || !actor.clientIds.includes(row.business.clientId))) throw notFound("Task");
  const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, taskId)).orderBy(taskEvents.createdAt);
  const handler = handlers.get(row.task.refType);
  const preview: Awaited<ReturnType<TaskHandler["preview"]>> | null = handler ? await handler.preview(row.task).catch((e) => ({ title: row.task.title, body: `Preview unavailable: ${(e as Error).message}` })) : null;
  const assignee = row.task.assigneeUserId ? (await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, row.task.assigneeUserId)).limit(1))[0] : null;
  return { ...row, events, preview, editable: Boolean(handler?.editable), assignee };
}

export async function assignTask(actor: Actor, taskId: string, input: { assigneeUserId?: string | null; assigneeEmail?: string | null; dueAt?: Date | null; notify?: boolean }) {
  if (!can(actor.role, "content.create")) throw forbidden();
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.orgId, actor.orgId))).limit(1);
  if (!task) throw notFound("Task");
  if (input.assigneeUserId) {
    const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, input.assigneeUserId))).limit(1);
    if (!m) throw invalid("Assignee must be a member of this organization");
  }
  const [updated] = await db
    .update(tasks)
    .set({ assigneeUserId: input.assigneeUserId ?? null, assigneeEmail: input.assigneeEmail?.toLowerCase() ?? null, dueAt: input.dueAt ?? task.dueAt, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();
  await db.insert(taskEvents).values({ taskId, action: "assigned", actorType: "user", actorId: actor.userId, detail: { assigneeUserId: input.assigneeUserId, assigneeEmail: input.assigneeEmail } });
  if (input.notify && updated.assigneeEmail && updated.status === "open" && updated.kind === "approval") {
    const token = await issueApprovalToken(taskId, updated.assigneeEmail, handlers.get(task.refType)?.editable ? ["approve", "skip", "reject", "edit"] : ["approve", "skip", "reject"]);
    await sendApprovalEmail(updated, updated.assigneeEmail, token, db);
  }
  return updated;
}

/** Marks overdue open approval tasks as expired (does not publish anything). */
export async function expireOverdueTasks() {
  const res = await db
    .update(tasks)
    .set({ status: "expired", resolvedAt: new Date(), resolvedBy: "system", updatedAt: new Date() })
    .where(and(eq(tasks.status, "open"), eq(tasks.kind, "approval"), sql`${tasks.dueAt} < now() - interval '14 days'`))
    .returning({ id: tasks.id });
  return res.length;
}

export async function openTaskCounts(actor: Actor, businessId?: string) {
  const conds: SQL[] = [eq(tasks.orgId, actor.orgId), eq(tasks.status, "open"), eq(tasks.visibleInDashboard, true)];
  if (businessId) conds.push(eq(tasks.businessId, businessId));
  const rows = await db.select({ type: tasks.type, n: sql<number>`count(*)::int` }).from(tasks).where(and(...conds)).groupBy(tasks.type);
  return Object.fromEntries(rows.map((r) => [r.type, r.n])) as Partial<Record<TaskType, number>>;
}
