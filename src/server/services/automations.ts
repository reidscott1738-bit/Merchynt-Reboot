import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { automationExecutions, automationRules, businessLocations, integrations, integrationTargets, memberships, tasks, users, type AutomationSchedule, type AutomationType, AUTOMATION_TYPES } from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { invalid, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { AUTOMATION_META, parseConfig, aiVisibilityConfig, faqConfig, rankingAuditConfig, reportingConfig, reviewRequestsConfig, videoConfig } from "@/lib/automation-config";
import { computeNextRun, describeSchedule, validateSchedule } from "@/lib/schedule";
import { isValidEmail } from "@/lib/text";
import { monthPeriod } from "@/lib/report-math";
import { toLocalParts } from "@/lib/time";
import { queueEmail } from "../email";
import { button, layout, paragraph } from "../email/templates";
import { env } from "../env";
import { notifyOrgUsers } from "./notifications";

export type AutomationRule = typeof automationRules.$inferSelect;
export type Execution = typeof automationExecutions.$inferSelect;

export async function listAutomations(actor: Actor, businessId: string) {
  const b = await requireBusiness(actor, businessId);
  const rules = await db.select().from(automationRules).where(eq(automationRules.businessId, businessId));
  const recent = await db.select().from(automationExecutions).where(eq(automationExecutions.businessId, businessId)).orderBy(desc(automationExecutions.createdAt)).limit(200);
  return AUTOMATION_TYPES.map((type) => {
    const r = rules.find((x) => x.type === type)!;
    const runs = recent.filter((e) => e.ruleId === r?.id).slice(0, 10);
    const health = !r?.enabled ? "off" : r.consecutiveFailures >= 3 ? "failing" : r.consecutiveFailures > 0 ? "degraded" : r.lastSuccessAt ? "healthy" : "waiting";
    return { type, meta: { label: AUTOMATION_META[type].label, description: AUTOMATION_META[type].description, publishes: AUTOMATION_META[type].publishes }, rule: r, scheduleText: r ? describeSchedule(r.schedule) : "", timezone: b.timezone, runs, health };
  });
}

export const ruleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: z.object({ frequency: z.enum(["hourly", "daily", "weekly", "monthly"]), time: z.string(), daysOfWeek: z.array(z.number().int()).optional(), dayOfMonth: z.number().int().optional(), interval: z.number().int().optional() }).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  notificationRecipients: z.array(z.string()).max(10).optional(),
  showTasksInDashboard: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
});

export async function updateAutomation(actor: Actor, businessId: string, type: AutomationType, raw: unknown) {
  const b = await requireBusiness(actor, businessId, "automations.manage");
  const input = ruleUpdateSchema.parse(raw);
  const [rule] = await db.select().from(automationRules).where(and(eq(automationRules.businessId, businessId), eq(automationRules.type, type))).limit(1);
  if (!rule) throw notFound("Automation");
  const schedule = (input.schedule ?? rule.schedule) as AutomationSchedule;
  const errs = validateSchedule(schedule);
  if (errs.length) throw invalid(errs.join("; "));
  let config = rule.config;
  if (input.config) {
    const parsed = parseConfig(type, { ...rule.config, ...input.config });
    if (!parsed.success) throw invalid(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    config = parsed.data as Record<string, unknown>;
  }
  const recipients = input.notificationRecipients?.map((e) => e.trim()).filter(Boolean);
  if (recipients?.some((e) => !isValidEmail(e))) throw invalid("One of the notification emails is not valid");
  const enabled = input.enabled ?? rule.enabled;
  const scheduleChanged = JSON.stringify(schedule) !== JSON.stringify(rule.schedule);
  const now = new Date();
  const [u] = await db
    .update(automationRules)
    .set({
      enabled,
      schedule,
      config,
      approvalMode: typeof config.approvalMode === "string" ? config.approvalMode : rule.approvalMode,
      notificationRecipients: recipients ?? rule.notificationRecipients,
      showTasksInDashboard: input.showTasksInDashboard ?? rule.showTasksInDashboard,
      maxRetries: input.maxRetries ?? rule.maxRetries,
      nextRunAt: enabled ? (scheduleChanged || !rule.enabled || !rule.nextRunAt ? computeNextRun(schedule, b.timezone, now, rule.lastRunAt) : rule.nextRunAt) : null,
      consecutiveFailures: enabled && !rule.enabled ? 0 : rule.consecutiveFailures,
      updatedByUserId: actor.userId,
      updatedAt: now,
    })
    .where(eq(automationRules.id, rule.id))
    .returning();
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "automation.updated", target: { type: "automation", id: rule.id }, detail: { type, enabled, schedule: describeSchedule(schedule) } });
  return u;
}

/** Manual run: a new execution with its own idempotency key, regardless of schedule. */
export async function runAutomationNow(actor: Actor, businessId: string, type: AutomationType) {
  await requireBusiness(actor, businessId, "automations.manage");
  const [rule] = await db.select().from(automationRules).where(and(eq(automationRules.businessId, businessId), eq(automationRules.type, type))).limit(1);
  if (!rule) throw notFound("Automation");
  const [running] = await db.select().from(automationExecutions).where(and(eq(automationExecutions.ruleId, rule.id), inArray(automationExecutions.status, ["queued", "running"]))).limit(1);
  if (running) return running;
  const now = new Date();
  const [ex] = await db.insert(automationExecutions).values({ ruleId: rule.id, businessId, trigger: "manual", scheduledFor: now, idempotencyKey: `manual:${rule.id}:${now.getTime()}` }).returning();
  await enqueue("automation.run", { executionId: ex.id }, { idempotencyKey: `automation:${ex.id}`, maxAttempts: rule.maxRetries + 1, businessId, orgId: actor.orgId, timeoutMs: 15 * 60_000 });
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "automation.run_now", target: { type: "automation", id: rule.id }, detail: { type } });
  return ex;
}

/**
 * Scheduler tick (run every minute by the worker). Claims due rules with
 * SKIP LOCKED, creates one execution per (rule, scheduled time) using an
 * idempotency key, and advances next_run_at. Safe to run on several workers.
 */
export async function schedulerTick(now = new Date()) {
  return db.transaction(async (tx) => {
    const due = await tx.execute<{ id: string }>(sql`select id from automation_rules where enabled and next_run_at <= ${now} order by next_run_at limit 100 for update skip locked`);
    let created = 0;
    for (const { id } of due.rows) {
      const [rule] = await tx.select().from(automationRules).where(eq(automationRules.id, id)).limit(1);
      const [b] = await tx.select().from(businessLocations).where(eq(businessLocations.id, rule.businessId)).limit(1);
      const scheduledFor = rule.nextRunAt!;
      if (b.status !== "active") {
        await tx.update(automationRules).set({ enabled: false, nextRunAt: null }).where(eq(automationRules.id, rule.id));
        continue;
      }
      const inserted = await tx
        .insert(automationExecutions)
        .values({ ruleId: rule.id, businessId: rule.businessId, trigger: "schedule", scheduledFor, idempotencyKey: `schedule:${rule.id}:${scheduledFor.toISOString()}` })
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) {
        await enqueue("automation.run", { executionId: inserted[0].id }, { idempotencyKey: `automation:${inserted[0].id}`, maxAttempts: rule.maxRetries + 1, businessId: rule.businessId, orgId: b.orgId, timeoutMs: 15 * 60_000 }, tx);
        created++;
      }
      // If the worker was down, skip missed slots instead of running them all at once.
      const next = computeNextRun(rule.schedule, b.timezone, now > scheduledFor ? now : scheduledFor, scheduledFor);
      await tx.update(automationRules).set({ nextRunAt: next, lastRunAt: scheduledFor }).where(eq(automationRules.id, rule.id));
    }
    return { due: due.rows.length, created };
  });
}

type Runner = (rule: AutomationRule, ex: Execution) => Promise<Record<string, unknown>>;

const RUNNERS: Record<AutomationType, Runner> = {
  async posting(rule, ex) {
    const { generatePostBatch } = await import("./posts");
    const r = await generatePostBatch(rule.businessId, { executionId: ex.id });
    return { created: r.created, reason: "reason" in r ? r.reason : undefined };
  },
  async review_replies(rule) {
    const { processReviews, syncReviews } = await import("./reviews");
    let synced: Record<string, unknown> | string = "Google not connected";
    const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, rule.businessId)).limit(1);
    if (b.gbpLocationName && b.googleIntegrationId) synced = await syncReviews(rule.businessId, 3);
    const r = await processReviews(rule.businessId, { mode: "new" });
    return { synced, processed: r.processed, tally: r.tally };
  },
  async historical_reviews(rule) {
    const { processReviews } = await import("./reviews");
    const r = await processReviews(rule.businessId, { mode: "historical" });
    return { processed: r.processed, tally: r.tally };
  },
  async review_requests(rule) {
    const { sendDueForBusiness } = await import("./campaigns");
    const cfg = reviewRequestsConfig.parse(rule.config);
    return { campaigns: await sendDueForBusiness(rule.businessId, cfg.campaignIds) };
  },
  async faq_generation(rule) {
    const { generateFaqsForBusiness } = await import("./seo");
    const cfg = faqConfig.parse(rule.config);
    return generateFaqsForBusiness(rule.businessId, cfg.perRun, cfg.approvalMode, rule.notificationRecipients);
  },
  async website_updates(rule) {
    const { refreshPublishedSite } = await import("./websites");
    return refreshPublishedSite(rule.businessId);
  },
  async video_generation(rule) {
    const { runVideoAutomation } = await import("./videos");
    return runVideoAutomation(rule.businessId, videoConfig.parse(rule.config));
  },
  async reporting(rule, ex) {
    const { requestReport } = await import("./reports");
    const cfg = reportingConfig.parse(rule.config);
    const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, rule.businessId)).limit(1);
    const local = toLocalParts(ex.scheduledFor, b.timezone);
    const prevMonth = local.month === 1 ? { y: local.year - 1, m: 12 } : { y: local.year, m: local.month - 1 };
    const period = monthPeriod(prevMonth.y, prevMonth.m);
    const r = await requestReport({ businessId: rule.businessId, period, type: "monthly", include: cfg.includeSections, recipients: cfg.recipients });
    return { reportId: r.id, period };
  },
  async ranking_audit(rule) {
    const { runScheduledAudits } = await import("./rankings");
    return runScheduledAudits(rule.businessId, rankingAuditConfig.parse(rule.config).keywordIds);
  },
  async ai_visibility_audit(rule) {
    const { startAiVisibilityAudit } = await import("./ai-visibility");
    const cfg = aiVisibilityConfig.parse(rule.config);
    const a = await startAiVisibilityAudit(rule.businessId, { providers: cfg.providers, queriesPerKeyword: cfg.queriesPerKeyword, trigger: "schedule" });
    return { auditId: a.id };
  },
  async integration_health(rule) {
    const { healthCheck } = await import("./integrations");
    const rows = await db
      .selectDistinct({ i: integrations })
      .from(integrationTargets)
      .innerJoin(integrations, eq(integrations.id, integrationTargets.integrationId))
      .where(and(eq(integrationTargets.businessId, rule.businessId), sql`${integrations.status} <> 'revoked'`));
    const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, rule.businessId)).limit(1);
    const google = b.googleIntegrationId && !rows.some((r) => r.i.id === b.googleIntegrationId) ? await db.select().from(integrations).where(eq(integrations.id, b.googleIntegrationId)) : [];
    const results = [];
    for (const i of [...rows.map((r) => r.i), ...google]) results.push({ provider: i.provider, account: i.externalAccountName, ...(await healthCheck(i)) });
    return { checked: results.length, unhealthy: results.filter((r) => !r.ok).length, results };
  },
  async account_manager(rule) {
    return accountManagerDigest(rule.businessId, rule.notificationRecipients);
  },
};

/** Worker entry point for "automation.run". */
export async function executeAutomation(executionId: string, isFinalAttempt: boolean) {
  const [ex] = await db.select().from(automationExecutions).where(eq(automationExecutions.id, executionId)).limit(1);
  if (!ex || ["succeeded", "partial", "skipped"].includes(ex.status)) return { skipped: true };
  const [rule] = await db.select().from(automationRules).where(eq(automationRules.id, ex.ruleId)).limit(1);
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, rule.businessId)).limit(1);
  if (ex.trigger === "schedule" && !rule.enabled) {
    await db.update(automationExecutions).set({ status: "skipped", finishedAt: new Date(), error: "Automation was turned off" }).where(eq(automationExecutions.id, ex.id));
    return { skipped: true };
  }
  await db.update(automationExecutions).set({ status: "running", startedAt: ex.startedAt ?? new Date() }).where(eq(automationExecutions.id, ex.id));
  try {
    const summary = await RUNNERS[rule.type](rule, ex);
    const partial = Array.isArray((summary as { errors?: unknown[] }).errors) && ((summary as { errors: unknown[] }).errors.length > 0);
    await db.update(automationExecutions).set({ status: partial ? "partial" : "succeeded", summary, finishedAt: new Date(), error: null }).where(eq(automationExecutions.id, ex.id));
    await db.update(automationRules).set({ lastSuccessAt: new Date(), consecutiveFailures: 0, lastError: null }).where(eq(automationRules.id, rule.id));
    return summary;
  } catch (e) {
    const message = (e as Error).message;
    if (!isFinalAttempt) {
      await db.update(automationExecutions).set({ status: "queued", error: `Retrying: ${message}` }).where(eq(automationExecutions.id, ex.id));
      throw e;
    }
    await db.update(automationExecutions).set({ status: "failed", finishedAt: new Date(), error: message }).where(eq(automationExecutions.id, ex.id));
    const [u] = await db.update(automationRules).set({ lastFailureAt: new Date(), lastError: message, consecutiveFailures: sql`${automationRules.consecutiveFailures} + 1` }).where(eq(automationRules.id, rule.id)).returning();
    if (u.consecutiveFailures === 1 || u.consecutiveFailures === 3) {
      await notifyOrgUsers(b.orgId, b.id, { type: "automation.failed", title: `${AUTOMATION_META[rule.type].label} failed${u.consecutiveFailures === 3 ? " three times in a row" : ""}`, body: message, link: `/b/${b.id}/automations` });
    }
    await logActivity({ orgId: b.orgId, businessId: b.id, actor: systemActor, action: "automation.failed", target: { type: "automation", id: rule.id }, detail: { error: message } });
    return { failed: message };
  }
}

export async function listExecutions(actor: Actor, businessId: string, type?: AutomationType) {
  await requireBusiness(actor, businessId);
  const conds = [eq(automationExecutions.businessId, businessId)];
  if (type) conds.push(eq(automationRules.type, type));
  return db.select({ ex: automationExecutions, type: automationRules.type }).from(automationExecutions).innerJoin(automationRules, eq(automationRules.id, automationExecutions.ruleId)).where(and(...conds)).orderBy(desc(automationExecutions.createdAt)).limit(100);
}

/** Daily digest: what needs a person. Sent only when there is something to say. */
export async function accountManagerDigest(businessId: string, extraRecipients: string[]) {
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const open = await db.select().from(tasks).where(and(eq(tasks.businessId, businessId), eq(tasks.status, "open"))).orderBy(tasks.dueAt).limit(20);
  const failing = await db.select().from(automationRules).where(and(eq(automationRules.businessId, businessId), eq(automationRules.enabled, true), sql`${automationRules.consecutiveFailures} > 0`));
  const missing: string[] = [];
  if (!b.phone) missing.push("business phone");
  if (!b.hours) missing.push("business hours");
  if (!b.googleReviewUrl) missing.push("Google review link");
  if (!b.gbpLocationName) missing.push("Google Business Profile connection");
  if (!open.length && !failing.length && !missing.length) return { sent: 0, reason: "Nothing needs attention" };
  const overdue = open.filter((t) => t.dueAt && t.dueAt < new Date());
  const admins = await db.select({ email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, b.orgId), inArray(memberships.role, ["owner", "admin"]), eq(memberships.status, "active")));
  const to = Array.from(new Set([...admins.map((a) => a.email), ...extraRecipients]));
  const base = env().APP_URL.replace(/\/$/, "");
  const lines = [
    open.length ? `${open.length} task(s) waiting${overdue.length ? `, ${overdue.length} overdue` : ""}: ${open.slice(0, 5).map((t) => t.title).join("; ")}` : null,
    failing.length ? `Automations with recent failures: ${failing.map((f) => `${AUTOMATION_META[f.type].label} (${f.lastError ?? "error"})`).join("; ")}` : null,
    missing.length ? `Missing details: ${missing.join(", ")}` : null,
  ].filter(Boolean) as string[];
  for (const email of to) {
    await queueEmail({ orgId: b.orgId, to: email, subject: `${b.name}: ${open.length} item(s) need attention`, html: layout({ name: env().APP_NAME, color: "#2563eb" }, `Today for ${b.name}`, lines.map(paragraph).join("") + button(`${base}/b/${b.id}/tasks`, "Open tasks", "#2563eb")), text: lines.join("\n"), template: "account_manager" });
  }
  return { sent: to.length, openTasks: open.length, failing: failing.length, missing };
}
