import { and, asc, between, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiVisibilityAudits,
  aiVisibilityQueries,
  auditConfigurations,
  businessLocations,
  contentItems,
  creditLedger,
  keywords,
  mediaAssets,
  organizationBranding,
  performanceMetrics,
  rankingAudits,
  reportDeliveries,
  reports,
  reviewReplies,
  reviews,
} from "../db/schema";
import { assertCan, requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { AppError, invalid, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { queueEmail } from "../email";
import { env } from "../env";
import * as gbp from "../integrations/google/gbp";
import { googleContext } from "./integrations";
import { summarize } from "./ai-visibility";
import { generateReportNarrative } from "../ai/tasks";
import { recordAiUsage, recordUsage } from "./usage";
import { estimatedValue, previousPeriod, relativeChange, sumOrNull, type MetricValue } from "@/lib/report-math";
import { escapeHtml } from "@/lib/text";

export type Report = typeof reports.$inferSelect;
export const ON_DEMAND_REPORT_CREDITS = 1;

/* ---------------- Google performance data ---------------- */

export async function syncPerformanceMetrics(businessId: string, start: Date, end: Date) {
  const g = await googleContext(businessId);
  const rows = await gbp.fetchDailyMetrics(g.token, g.locationName, start, end);
  for (const r of rows) {
    await db
      .insert(performanceMetrics)
      .values({ businessId, metric: r.metric, date: r.date, value: r.value, source: "google_performance" })
      .onConflictDoUpdate({ target: [performanceMetrics.businessId, performanceMetrics.metric, performanceMetrics.date, performanceMetrics.source], set: { value: r.value, fetchedAt: new Date() } });
  }
  return { rows: rows.length };
}

async function metricSum(businessId: string, metrics: string[], start: string, end: string) {
  const [r] = await db
    .select({ total: sql<number | null>`sum(${performanceMetrics.value})::int`, days: sql<number>`count(distinct ${performanceMetrics.date})::int`, demo: sql<boolean>`bool_or(${performanceMetrics.isDemo})` })
    .from(performanceMetrics)
    .where(and(eq(performanceMetrics.businessId, businessId), inArray(performanceMetrics.metric, metrics), between(performanceMetrics.date, start, end)));
  return { total: r.days ? r.total : null, days: r.days, demo: Boolean(r.demo) };
}

const IMPRESSIONS = ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"];

/* ---------------- Report data ---------------- */

export type ReportSection = { key: string; title: string; metrics: MetricValue[]; rows?: Record<string, unknown>[]; note?: string; demo?: boolean };
export type ReportData = { period: { start: string; end: string }; previous: { start: string; end: string }; sections: ReportSection[]; containsDemoData: boolean; generatedAt: string; sources: string[] };

/** Collects measured data for a period. Missing data stays null and is labeled; nothing is filled in. */
export async function buildReportData(businessId: string, period: { start: string; end: string }, include: string[]): Promise<ReportData> {
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const prev = previousPeriod(period.start, period.end);
  const sections: ReportSection[] = [];
  const sources = new Set<string>();
  const gSrc = "Google Business Profile Performance API";
  const pStart = new Date(`${period.start}T00:00:00Z`);
  const pEnd = new Date(`${period.end}T23:59:59Z`);
  const prevStart = new Date(`${prev.start}T00:00:00Z`);
  const prevEnd = new Date(`${prev.end}T23:59:59Z`);
  let demo = false;
  const mv = (key: string, label: string, kind: MetricValue["kind"], value: number | null, previous: number | null, source: string, note?: string): MetricValue => ({ key, label, kind, value, previous, change: relativeChange(value, previous), source, period, note });

  if (include.includes("performance")) {
    const cur = await metricSum(businessId, IMPRESSIONS, period.start, period.end);
    const old = await metricSum(businessId, IMPRESSIONS, prev.start, prev.end);
    if (cur.total != null) sources.add(gSrc);
    demo ||= cur.demo;
    sections.push({
      key: "performance",
      title: "Profile visibility",
      metrics: [mv("impressions", "Profile views (Search and Maps)", "observed", cur.total, old.total, gSrc, cur.total == null ? "No performance data recorded. Connect Google Business Profile to collect it." : cur.days < 20 ? `Data for ${cur.days} days of the period` : undefined)],
      demo: cur.demo,
    });
  }

  if (include.includes("lead_actions")) {
    const parts = [
      ["calls", "Calls", ["CALL_CLICKS"]],
      ["website", "Website clicks", ["WEBSITE_CLICKS"]],
      ["directions", "Direction requests", ["BUSINESS_DIRECTION_REQUESTS"]],
    ] as const;
    const metrics: MetricValue[] = [];
    const curVals: (number | null)[] = [];
    const prevVals: (number | null)[] = [];
    for (const [key, label, m] of parts) {
      const c = await metricSum(businessId, [...m], period.start, period.end);
      const p = await metricSum(businessId, [...m], prev.start, prev.end);
      demo ||= c.demo;
      curVals.push(c.total);
      prevVals.push(p.total);
      metrics.push(mv(key, label, "observed", c.total, p.total, gSrc));
    }
    const total = sumOrNull(curVals);
    const prevTotal = sumOrNull(prevVals);
    metrics.push(mv("lead_actions", "Total lead actions", "calculated", total, prevTotal, "Sum of calls, website clicks and direction requests"));
    const acv = b.averageCustomerValue ? Number(b.averageCustomerValue) : null;
    if (acv) {
      metrics.push(
        mv("estimated_value", "Estimated value of lead actions", "estimate", estimatedValue(total, acv), estimatedValue(prevTotal, acv), "Calculated", `Estimate only: lead actions × $${acv} average customer value you entered. Not every action becomes a customer, and this is not revenue.`),
      );
    }
    sections.push({ key: "lead_actions", title: "Lead actions", metrics });
  }

  if (include.includes("rankings")) {
    const audits = await db
      .selectDistinctOn([auditConfigurations.keywordId], { audit: rankingAudits, keyword: keywords.phrase, config: auditConfigurations })
      .from(rankingAudits)
      .innerJoin(auditConfigurations, eq(auditConfigurations.id, rankingAudits.configurationId))
      .innerJoin(keywords, eq(keywords.id, auditConfigurations.keywordId))
      .where(and(eq(rankingAudits.businessId, businessId), inArray(rankingAudits.status, ["completed", "partial"]), lte(rankingAudits.createdAt, pEnd)))
      .orderBy(auditConfigurations.keywordId, desc(rankingAudits.createdAt));
    const rows = audits.map((a) => {
      const s = a.audit.stats as Record<string, number | null> | null;
      return { keyword: a.keyword, date: a.audit.createdAt.toISOString().slice(0, 10), averageRank: s?.averageRank ?? null, top3Share: s?.top3Share ?? null, coverage: s?.coverage ?? null, grid: `${a.config.gridSize}x${a.config.gridSize}, ${a.config.radiusKm} km`, demo: a.audit.isDemo, provider: a.audit.provider };
    });
    if (rows.length) sources.add("Grid ranking audits");
    const anyDemo = rows.some((r) => r.demo);
    demo ||= anyDemo;
    sections.push({ key: "rankings", title: "Local rankings", metrics: [], rows, demo: anyDemo, note: rows.length ? "Average rank counts only points where the business was found; points with failed observations are excluded." : "No ranking audits have run yet." });
  }

  if (include.includes("competitors")) {
    const comps = await db.execute(sql`
      select c.name, s.appearances, s.average_rank, s.top3_count, c.is_demo
      from competitor_snapshots s join competitors c on c.id = s.competitor_id
      where c.business_id = ${businessId} and s.captured_at <= ${pEnd}
      and s.audit_id in (select id from ranking_audits where business_id = ${businessId} and created_at <= ${pEnd} order by created_at desc limit 5)
      order by s.top3_count desc, s.appearances desc limit 8`);
    const rows = (comps.rows as { name: string; appearances: number; average_rank: number; top3_count: number; is_demo: boolean }[]).map((r) => ({ name: r.name, appearances: r.appearances, averageRank: r.average_rank, top3: r.top3_count, demo: r.is_demo }));
    const anyDemo = rows.some((r) => r.demo);
    demo ||= anyDemo;
    sections.push({ key: "competitors", title: "Competitors seen in your rankings", metrics: [], rows, demo: anyDemo, note: rows.length ? "From the most recent ranking audits." : "No competitor data yet." });
  }

  if (include.includes("ai_visibility")) {
    const [audit] = await db.select().from(aiVisibilityAudits).where(and(eq(aiVisibilityAudits.businessId, businessId), inArray(aiVisibilityAudits.status, ["completed", "partial"]), lte(aiVisibilityAudits.createdAt, pEnd))).orderBy(desc(aiVisibilityAudits.createdAt)).limit(1);
    if (audit) {
      const q = await db.select().from(aiVisibilityQueries).where(eq(aiVisibilityQueries.auditId, audit.id));
      const s = summarize(q);
      const anyDemo = s.providers.some((p) => p.demo);
      demo ||= anyDemo;
      sources.add("AI assistant answers recorded by AI visibility audits");
      sections.push({ key: "ai_visibility", title: "AI assistant visibility", metrics: [], rows: s.providers.map((p) => ({ assistant: p.provider, asked: p.asked, mentioned: p.mentioned, share: p.share, unsupported: p.unsupported, demo: p.demo })), demo: anyDemo, note: `Audit from ${audit.createdAt.toISOString().slice(0, 10)}. AI answers vary between runs.` });
    } else sections.push({ key: "ai_visibility", title: "AI assistant visibility", metrics: [], rows: [], note: "No AI visibility audit has run yet." });
  }

  if (include.includes("reviews")) {
    const agg = async (s: Date, e: Date) => {
      const [r] = await db.select({ n: count(), avg: sql<number | null>`avg(${reviews.rating})::float`, demo: sql<boolean>`bool_or(${reviews.isDemo})` }).from(reviews).where(and(eq(reviews.businessId, businessId), gte(reviews.publishedAt, s), lte(reviews.publishedAt, e)));
      return r;
    };
    const c = await agg(pStart, pEnd);
    const p = await agg(prevStart, prevEnd);
    const [rep] = await db.select({ n: count() }).from(reviewReplies).where(and(eq(reviewReplies.businessId, businessId), eq(reviewReplies.status, "published"), gte(reviewReplies.publishedAt, pStart), lte(reviewReplies.publishedAt, pEnd)));
    demo ||= Boolean(c.demo);
    sources.add("Reviews synced from Google");
    sections.push({
      key: "reviews",
      title: "Reviews",
      metrics: [
        mv("new_reviews", "New reviews", "observed", c.n, p.n, "Reviews synced from Google"),
        mv("avg_rating", "Average rating of new reviews", "calculated", c.avg != null ? Math.round(c.avg * 100) / 100 : null, p.avg != null ? Math.round(p.avg * 100) / 100 : null, "Reviews synced from Google"),
        mv("replies", "Replies published", "observed", rep.n, null, "Recorded by this platform"),
      ],
      demo: Boolean(c.demo),
    });
  }

  if (include.includes("activity")) {
    const [posts] = await db.select({ n: count() }).from(contentItems).where(and(eq(contentItems.businessId, businessId), eq(contentItems.type, "gbp_post"), inArray(contentItems.status, ["published", "partially_published"]), gte(contentItems.publishedAt, pStart), lte(contentItems.publishedAt, pEnd)));
    const [photos] = await db.select({ n: count() }).from(mediaAssets).where(and(eq(mediaAssets.businessId, businessId), eq(mediaAssets.kind, "image"), eq(mediaAssets.moderationStatus, "approved"), gte(mediaAssets.createdAt, pStart), lte(mediaAssets.createdAt, pEnd)));
    const [demoPubs] = await db.execute(sql`select count(*)::int as n from publication_jobs where business_id = ${businessId} and is_demo and completed_at between ${pStart} and ${pEnd}`).then((r) => r.rows as { n: number }[]);
    sources.add("Recorded by this platform");
    sections.push({
      key: "activity",
      title: "Work completed",
      metrics: [mv("posts", "Posts published", "observed", posts.n, null, "Recorded by this platform"), mv("photos", "Photos added", "observed", photos.n, null, "Recorded by this platform")],
      note: demoPubs.n ? `${demoPubs.n} demo publication(s) in this period were not sent anywhere and are not counted.` : undefined,
    });
  }

  return { period, previous: prev, sections, containsDemoData: demo, generatedAt: new Date().toISOString(), sources: [...sources] };
}

function factsForNarrative(data: ReportData) {
  const lines: string[] = [];
  for (const s of data.sections) {
    for (const m of s.metrics) {
      if (m.value == null) continue;
      lines.push(`${m.label}: ${m.value}${m.previous != null ? ` (previous period ${m.previous})` : ""} [${m.kind}${m.kind === "estimate" ? ", estimate" : ""}; ${m.source}]`);
    }
    if (s.key === "rankings") for (const r of s.rows ?? []) lines.push(`Ranking audit for "${r.keyword}": average rank ${r.averageRank ?? "not found"}, top-3 share ${r.top3Share != null ? Math.round(Number(r.top3Share) * 100) + "%" : "n/a"}${r.demo ? " [demo data]" : ""}`);
  }
  if (data.containsDemoData) lines.push("Some figures are demo data and not real measurements.");
  return lines;
}

/* ---------------- Credits ---------------- */

export async function creditBalance(orgId: string) {
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` }).from(creditLedger).where(eq(creditLedger.orgId, orgId));
  return r.n;
}

export async function grantCredits(actor: Actor, amount: number, note?: string) {
  assertCan(actor, "org.manage");
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10000) throw invalid("Enter a whole number of credits");
  await db.insert(creditLedger).values({ orgId: actor.orgId, delta: amount, reason: amount > 0 ? "grant" : "adjustment", note: note ?? null });
  return creditBalance(actor.orgId);
}

/* ---------------- Generation ---------------- */

export async function requestReport(input: { businessId: string; period: { start: string; end: string }; type: "monthly" | "on_demand"; include?: string[]; recipients?: string[] }, actor?: Actor) {
  const b = actor ? await requireBusiness(actor, input.businessId, "reports.manage") : (await db.select().from(businessLocations).where(eq(businessLocations.id, input.businessId)).limit(1))[0];
  if (input.period.start > input.period.end) throw invalid("The report period is invalid");
  const report = await db.transaction(async (tx) => {
    let charged = 0;
    if (input.type === "on_demand") {
      // Lock the org's ledger rows so concurrent requests cannot overspend.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${b.orgId}))`);
      const [bal] = await tx.select({ n: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` }).from(creditLedger).where(eq(creditLedger.orgId, b.orgId));
      if (bal.n < ON_DEMAND_REPORT_CREDITS) throw new AppError(`On-demand reports use ${ON_DEMAND_REPORT_CREDITS} credit; your balance is ${bal.n}.`, "invalid");
      charged = ON_DEMAND_REPORT_CREDITS;
    }
    const [r] = await tx.insert(reports).values({ orgId: b.orgId, businessId: b.id, type: input.type, periodStart: input.period.start, periodEnd: input.period.end, creditsCharged: charged, requestedByUserId: actor?.userId ?? null, data: { include: input.include ?? null, recipients: input.recipients ?? [] } }).returning();
    if (charged) await tx.insert(creditLedger).values({ orgId: b.orgId, delta: -charged, reason: "report_charge", reportId: r.id });
    await enqueue("report.generate", { reportId: r.id }, { idempotencyKey: `report:${r.id}`, businessId: b.id, orgId: b.orgId, maxAttempts: 3 }, tx);
    return r;
  });
  await logActivity({ orgId: b.orgId, businessId: b.id, actor: actor ? userActor(actor.userId) : systemActor, action: "report.requested", target: { type: "report", id: report.id } });
  return report;
}

const ALL_SECTIONS = ["performance", "lead_actions", "rankings", "competitors", "ai_visibility", "reviews", "activity"];

export async function generateReport(reportId: string, isFinalAttempt: boolean) {
  const [r] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!r || r.status === "ready") return { skipped: true };
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, r.businessId)).limit(1);
  const req = (r.data ?? {}) as { include?: string[] | null; recipients?: string[] };
  await db.update(reports).set({ status: "generating" }).where(eq(reports.id, r.id));
  try {
    // Refresh Google data first when connected; a sync failure is noted, not hidden.
    let syncNote: string | null = null;
    if (b.gbpLocationName && b.googleIntegrationId) {
      try {
        const prev = previousPeriod(r.periodStart, r.periodEnd);
        await syncPerformanceMetrics(b.id, new Date(`${prev.start}T00:00:00Z`), new Date(`${r.periodEnd}T00:00:00Z`));
      } catch (e) {
        syncNote = `Google performance data could not be refreshed: ${(e as Error).message}`;
      }
    }
    const data = await buildReportData(b.id, { start: r.periodStart, end: r.periodEnd }, req.include?.length ? req.include : ALL_SECTIONS);
    const n = await generateReportNarrative(b.name, factsForNarrative(data));
    await recordAiUsage(b.orgId, b.id, n.meta);
    const narrative = n.data.summary + (syncNote ? `\n\nNote: ${syncNote}` : "");
    const [brand] = await db.select().from(organizationBranding).where(eq(organizationBranding.orgId, b.orgId)).limit(1);
    const html = renderReportHtml(b.name, data, narrative, { name: brand?.displayName ?? env().APP_NAME, color: brand?.primaryColor ?? "#2563eb", logoUrl: brand?.logoUrl ?? null, footer: brand?.reportFooter ?? null });
    await db.update(reports).set({ status: "ready", data: { ...data, request: req }, narrative, html, generatedAt: new Date(), error: null }).where(eq(reports.id, r.id));
    await recordUsage(b.orgId, b.id, "report", 1);
    for (const to of req.recipients ?? []) await deliverReport(r.id, to);
    return { ok: true };
  } catch (e) {
    if (isFinalAttempt) {
      await db.update(reports).set({ status: "failed", error: (e as Error).message }).where(eq(reports.id, r.id));
      if (r.creditsCharged) await db.insert(creditLedger).values({ orgId: r.orgId, delta: r.creditsCharged, reason: "report_refund", reportId: r.id, note: "Report generation failed" });
    }
    throw e;
  }
}

function fmt(m: MetricValue) {
  if (m.value == null) return "—";
  if (m.key === "estimated_value") return `$${m.value.toLocaleString("en-US")}`;
  return m.value.toLocaleString("en-US");
}
function fmtChange(c: number | null) {
  if (c == null) return "";
  const pct = Math.round(c * 100);
  return `<span style="color:${pct >= 0 ? "#047857" : "#b91c1c"}">${pct >= 0 ? "+" : ""}${pct}%</span>`;
}

export function renderReportHtml(businessName: string, data: ReportData, narrative: string, brand: { name: string; color: string; logoUrl: string | null; footer: string | null }) {
  const e = escapeHtml;
  const sec = data.sections
    .map((s) => {
      const metrics = s.metrics.length
        ? `<table style="width:100%;border-collapse:collapse;margin:8px 0">${s.metrics
            .map(
              (m) =>
                `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${e(m.label)}${m.kind === "estimate" ? ' <em style="color:#92400e">(estimate)</em>' : ""}<div style="font-size:11px;color:#6b7280">${e(m.source)}${m.note ? ` · ${e(m.note)}` : ""}</div></td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fmt(m)}</td><td style="padding:6px 0 6px 10px;border-bottom:1px solid #eee;text-align:right;font-size:12px">${fmtChange(m.change)}</td></tr>`,
            )
            .join("")}</table>`
        : "";
      const rows = s.rows?.length
        ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0"><tr>${Object.keys(s.rows[0])
            .map((k) => `<th style="text-align:left;padding:4px;border-bottom:2px solid #ddd">${e(k)}</th>`)
            .join("")}</tr>${s.rows
            .map((r) => `<tr>${Object.values(r).map((v) => `<td style="padding:4px;border-bottom:1px solid #eee">${e(typeof v === "number" && v < 1 && v > 0 ? `${Math.round(v * 100)}%` : v == null ? "—" : String(v))}</td>`).join("")}</tr>`)
            .join("")}</table>`
        : "";
      return `<section style="margin:20px 0"><h2 style="font-size:16px;margin:0 0 6px;color:${e(brand.color)}">${e(s.title)}${s.demo ? ' <span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px">DEMO DATA</span>' : ""}</h2>${metrics}${rows}${s.note ? `<p style="font-size:12px;color:#6b7280;margin:4px 0">${e(s.note)}</p>` : ""}</section>`;
    })
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;max-width:760px;margin:0 auto">
  <header style="border-bottom:3px solid ${e(brand.color)};padding:12px 0;display:flex;justify-content:space-between;align-items:center">${brand.logoUrl ? `<img src="${e(brand.logoUrl)}" alt="${e(brand.name)}" height="32">` : `<strong>${e(brand.name)}</strong>`}<span style="font-size:13px;color:#6b7280">${e(data.period.start)} to ${e(data.period.end)}</span></header>
  <h1 style="font-size:22px;margin:16px 0 4px">${e(businessName)}: performance report</h1>
  ${data.containsDemoData ? '<p style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:6px;font-size:13px">This report contains demo data that is not a real measurement. Demo figures are labeled.</p>' : ""}
  <p style="line-height:1.55;white-space:pre-wrap">${e(narrative)}</p>
  ${sec}
  <p style="font-size:11px;color:#6b7280;margin-top:24px">Compared with ${e(data.previous.start)} to ${e(data.previous.end)}. Sources: ${e(data.sources.join("; ") || "none")}. Observed = reported by the source; calculated = derived from observed data; estimate = based on assumptions you provided.</p>
  ${brand.footer ? `<footer style="font-size:12px;color:#6b7280;border-top:1px solid #eee;padding-top:8px">${e(brand.footer)}</footer>` : ""}
</div>`;
}

export async function deliverReport(reportId: string, recipient: string) {
  const [r] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!r || r.status !== "ready" || !r.html) throw invalid("The report is not ready");
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, r.businessId)).limit(1);
  const msg = await queueEmail({ orgId: r.orgId, to: recipient, subject: `${b.name} report: ${r.periodStart} to ${r.periodEnd}`, html: r.html, text: `${r.narrative ?? ""}\n\nOpen the HTML version of this email to see the full report.`, template: "report", related: { type: "report", id: r.id } });
  await db.insert(reportDeliveries).values({ reportId, recipient, status: msg.status === "queued" ? "queued" : "failed", emailMessageId: msg.id, error: msg.status === "suppressed" ? "Recipient is suppressed" : null });
}

export async function sendReportTo(actor: Actor, businessId: string, reportId: string, recipients: string[]) {
  await requireBusiness(actor, businessId, "reports.manage");
  const [r] = await db.select().from(reports).where(and(eq(reports.id, reportId), eq(reports.businessId, businessId))).limit(1);
  if (!r) throw notFound("Report");
  for (const to of recipients) await deliverReport(r.id, to);
}

export async function listReports(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId, "reports.view");
  return db.select({ id: reports.id, type: reports.type, periodStart: reports.periodStart, periodEnd: reports.periodEnd, status: reports.status, generatedAt: reports.generatedAt, createdAt: reports.createdAt, creditsCharged: reports.creditsCharged, error: reports.error }).from(reports).where(eq(reports.businessId, businessId)).orderBy(desc(reports.createdAt)).limit(60);
}

export async function getReport(actor: Actor, businessId: string, reportId: string) {
  await requireBusiness(actor, businessId, "reports.view");
  const [r] = await db.select().from(reports).where(and(eq(reports.id, reportId), eq(reports.businessId, businessId))).limit(1);
  if (!r) throw notFound("Report");
  const deliveries = await db.select().from(reportDeliveries).where(eq(reportDeliveries.reportId, r.id)).orderBy(asc(reportDeliveries.createdAt));
  return { report: r, deliveries };
}
