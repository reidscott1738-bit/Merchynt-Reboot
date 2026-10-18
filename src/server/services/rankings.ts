import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  auditConfigurations,
  businessLocations,
  businessServices,
  competitors,
  competitorSnapshots,
  keywordDemandHistory,
  keywords,
  rankingAudits,
  rankingObservations,
  type ObservedListing,
} from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { invalid, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { getRankingProvider, rankingProviderStatus } from "../integrations/ranking";
import { generateGrid } from "@/lib/geo";
import { aggregateCompetitors, auditStats, compareAudits, type Obs } from "@/lib/ranking-metrics";
import { normalizeKeyword, textSimilarity } from "@/lib/text";
import { assertWithinLimit, recordUsage } from "./usage";
import { notifyOrgUsers } from "./notifications";

export type Keyword = typeof keywords.$inferSelect;
export type AuditConfig = typeof auditConfigurations.$inferSelect;

/* ---------------- Keywords ---------------- */

export const keywordInput = z.object({
  phrase: z.string().trim().min(2).max(80),
  city: z.string().trim().max(80).nullable().optional(),
  intent: z.enum(["discovery", "comparison", "branded", "transactional", "informational"]).default("discovery"),
  serviceId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(1).max(5).default(3),
  isTracked: z.boolean().default(true),
});

export async function listKeywords(actor: Actor, businessId: string, includeArchived = false) {
  await requireBusiness(actor, businessId);
  const conds = [eq(keywords.businessId, businessId)];
  if (!includeArchived) conds.push(isNull(keywords.archivedAt));
  const rows = await db.select().from(keywords).where(and(...conds)).orderBy(asc(keywords.priority), asc(keywords.phrase));
  const latest = rows.length
    ? await db
        .selectDistinctOn([auditConfigurations.keywordId], { keywordId: auditConfigurations.keywordId, audit: rankingAudits })
        .from(rankingAudits)
        .innerJoin(auditConfigurations, eq(auditConfigurations.id, rankingAudits.configurationId))
        .where(and(eq(rankingAudits.businessId, businessId), inArray(rankingAudits.status, ["completed", "partial"])))
        .orderBy(auditConfigurations.keywordId, desc(rankingAudits.createdAt))
    : [];
  return rows.map((k) => ({ ...k, latestAudit: latest.find((l) => l.keywordId === k.id)?.audit ?? null }));
}

export async function addKeyword(actor: Actor, businessId: string, raw: unknown, source: "user" | "suggested" = "user") {
  await requireBusiness(actor, businessId, "business.edit");
  const input = keywordInput.parse(raw);
  if (input.serviceId) {
    const [s] = await db.select().from(businessServices).where(and(eq(businessServices.id, input.serviceId), eq(businessServices.businessId, businessId))).limit(1);
    if (!s) throw invalid("That service does not belong to this business");
  }
  const normalized = normalizeKeyword(input.phrase);
  const [existing] = await db.select().from(keywords).where(and(eq(keywords.businessId, businessId), eq(keywords.normalized, normalized), sql`coalesce(${keywords.city}, '') = ${input.city ?? ""}`)).limit(1);
  if (existing) {
    if (existing.archivedAt) {
      const [k] = await db.update(keywords).set({ archivedAt: null, isTracked: input.isTracked, updatedAt: new Date() }).where(eq(keywords.id, existing.id)).returning();
      return k;
    }
    throw invalid(`"${input.phrase}" is already a keyword${input.city ? ` for ${input.city}` : ""}`);
  }
  const [k] = await db.insert(keywords).values({ businessId, phrase: input.phrase, normalized, city: input.city ?? null, intent: input.intent, serviceId: input.serviceId ?? null, priority: input.priority, isTracked: input.isTracked, source }).returning();
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "keyword.added", target: { type: "keyword", id: k.id }, detail: { phrase: k.phrase } });
  return k;
}

export async function updateKeyword(actor: Actor, businessId: string, id: string, raw: unknown) {
  await requireBusiness(actor, businessId, "business.edit");
  const patch = keywordInput.partial().parse(raw);
  const set: Partial<Keyword> = { ...patch, updatedAt: new Date() };
  if (patch.phrase) set.normalized = normalizeKeyword(patch.phrase);
  const [k] = await db.update(keywords).set(set).where(and(eq(keywords.id, id), eq(keywords.businessId, businessId))).returning();
  if (!k) throw notFound("Keyword");
  return k;
}

export async function archiveKeyword(actor: Actor, businessId: string, id: string) {
  await requireBusiness(actor, businessId, "business.edit");
  await db.update(keywords).set({ archivedAt: new Date(), isTracked: false }).where(and(eq(keywords.id, id), eq(keywords.businessId, businessId)));
}

/**
 * Suggests keywords from the business's own services, category and service
 * areas. Suggestions carry no search volume unless a data provider supplies it.
 */
export async function suggestKeywords(actor: Actor, businessId: string) {
  const b = await requireBusiness(actor, businessId);
  const svcs = await db.select().from(businessServices).where(and(eq(businessServices.businessId, businessId), eq(businessServices.status, "active")));
  const existing = new Set((await db.select({ n: keywords.normalized }).from(keywords).where(eq(keywords.businessId, businessId))).map((r) => r.n));
  const city = b.city ?? b.serviceArea?.places?.[0] ?? null;
  const bases = [b.primaryCategory, ...b.secondaryCategories.slice(0, 2), ...svcs.map((s) => s.name)].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  const out: { phrase: string; city: string | null; intent: Keyword["intent"]; serviceId: string | null; reason: string }[] = [];
  for (const base of Array.from(new Set(bases))) {
    const svc = svcs.find((s) => s.name.toLowerCase() === base);
    const candidates: [string, Keyword["intent"], string][] = [
      [`${base} near me`, "discovery", "Common local discovery phrasing"],
      ...(city ? ([[`${base} ${city.toLowerCase()}`, "discovery", `Service plus your city (${city})`]] as [string, Keyword["intent"], string][]) : []),
      [`best ${base}`, "comparison", "Comparison phrasing"],
    ];
    for (const [phrase, intent, reason] of candidates) {
      if (existing.has(normalizeKeyword(phrase)) || out.some((o) => o.phrase === phrase)) continue;
      out.push({ phrase, city: null, intent, serviceId: svc?.id ?? null, reason });
    }
  }
  return out.slice(0, 20);
}

/** Refreshes search volume estimates. Without a configured provider nothing is stored. */
export async function refreshDemand(actor: Actor, businessId: string) {
  const b = await requireBusiness(actor, businessId, "audits.run");
  const status = rankingProviderStatus();
  if (!status.configured || status.isDemo) return { updated: 0, note: "No keyword volume provider is configured, so demand estimates are not available." };
  const provider = getRankingProvider({ name: b.name, placeId: b.googlePlaceId, lat: b.latitude ?? 0, lng: b.longitude ?? 0 });
  if (!provider.searchVolume) return { updated: 0, note: "The ranking provider does not supply search volume." };
  const kws = await db.select().from(keywords).where(and(eq(keywords.businessId, businessId), isNull(keywords.archivedAt)));
  const res = await provider.searchVolume(kws.map((k) => k.phrase), b.latitude != null && b.longitude != null ? { lat: b.latitude, lng: b.longitude } : null);
  let updated = 0;
  for (const r of res) {
    const k = kws.find((x) => x.phrase.toLowerCase() === r.keyword.toLowerCase());
    if (!k) continue;
    await db.update(keywords).set({ demandEstimate: r.volume, demandSource: provider.label, demandAsOf: new Date() }).where(eq(keywords.id, k.id));
    await db.insert(keywordDemandHistory).values({ keywordId: k.id, estimate: r.volume, source: provider.id });
    updated++;
  }
  return { updated, note: `Monthly search volume estimates from ${provider.label}.` };
}

/* ---------------- Audit configuration (versioned) ---------------- */

export const configInput = z.object({
  centerLat: z.number().min(-85).max(85),
  centerLng: z.number().min(-180).max(180),
  radiusKm: z.number().gt(0).max(50),
  gridSize: z.number().int().refine((n) => n >= 3 && n <= 15 && n % 2 === 1, "Grid size must be an odd number from 3 to 15"),
  device: z.enum(["desktop", "mobile"]).default("mobile"),
  language: z.string().min(2).max(8).default("en"),
  changeNote: z.string().max(200).optional(),
});

export async function currentConfig(keywordId: string) {
  const [c] = await db.select().from(auditConfigurations).where(and(eq(auditConfigurations.keywordId, keywordId), eq(auditConfigurations.isCurrent, true))).limit(1);
  return c ?? null;
}

/** Saves a new configuration version. Older audits keep pointing at the version they ran with. */
export async function saveAuditConfig(actor: Actor | null, businessId: string, keywordId: string, raw: unknown) {
  if (actor) await requireBusiness(actor, businessId, "audits.run");
  const input = configInput.parse(raw);
  const [k] = await db.select().from(keywords).where(and(eq(keywords.id, keywordId), eq(keywords.businessId, businessId))).limit(1);
  if (!k) throw notFound("Keyword");
  const cur = await currentConfig(keywordId);
  const provider = rankingProviderStatus();
  if (cur && cur.centerLat === input.centerLat && cur.centerLng === input.centerLng && cur.radiusKm === input.radiusKm && cur.gridSize === input.gridSize && cur.device === input.device && cur.language === input.language && cur.provider === provider.id) return cur;
  return db.transaction(async (tx) => {
    const [{ v }] = await tx.select({ v: sql<number>`coalesce(max(${auditConfigurations.version}), 0)::int` }).from(auditConfigurations).where(eq(auditConfigurations.keywordId, keywordId));
    await tx.update(auditConfigurations).set({ isCurrent: false }).where(eq(auditConfigurations.keywordId, keywordId));
    const [c] = await tx.insert(auditConfigurations).values({ businessId, keywordId, version: v + 1, ...input, provider: provider.id, isCurrent: true, changeNote: input.changeNote ?? (cur ? "Updated settings" : "Initial settings"), createdByUserId: actor?.userId ?? null }).returning();
    return c;
  });
}

async function ensureConfig(businessId: string, keywordId: string) {
  const cur = await currentConfig(keywordId);
  const provider = rankingProviderStatus();
  if (cur && cur.provider === provider.id) return cur;
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const lat = cur?.centerLat ?? b.latitude;
  const lng = cur?.centerLng ?? b.longitude;
  if (lat == null || lng == null) throw invalid("Add the business's map coordinates (Business Profile > Location) before running an audit");
  return saveAuditConfig(null, businessId, keywordId, { centerLat: lat, centerLng: lng, radiusKm: cur?.radiusKm ?? 5, gridSize: cur?.gridSize ?? 7, device: cur?.device ?? "mobile", language: cur?.language ?? "en", changeNote: cur ? `Provider changed to ${provider.id}` : "Default settings" });
}

/* ---------------- Running audits ---------------- */

export async function startAudit(businessId: string, keywordId: string, trigger: "manual" | "schedule", actor?: Actor) {
  if (actor) await requireBusiness(actor, businessId, "audits.run");
  const status = rankingProviderStatus();
  if (!status.configured) throw invalid("No ranking data provider is configured. Add DataForSEO credentials, or enable demo mode to see sample data.");
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const cfg = await ensureConfig(businessId, keywordId);
  const points = cfg.gridSize * cfg.gridSize;
  if (!status.isDemo) await assertWithinLimit(b.orgId, "ranking_point", points);
  const [running] = await db.select().from(rankingAudits).where(and(eq(rankingAudits.configurationId, cfg.id), inArray(rankingAudits.status, ["queued", "running"]))).limit(1);
  if (running) return running;
  const [audit] = await db.insert(rankingAudits).values({ businessId, configurationId: cfg.id, provider: status.id, isDemo: status.isDemo, trigger, pointsTotal: points }).returning();
  await enqueue("ranking.audit", { auditId: audit.id }, { idempotencyKey: `ranking-audit:${audit.id}`, timeoutMs: 20 * 60_000, maxAttempts: 3, orgId: b.orgId, businessId });
  await logActivity({ orgId: b.orgId, businessId, actor: actor ? userActor(actor.userId) : systemActor, action: "ranking_audit.started", target: { type: "ranking_audit", id: audit.id }, detail: { keywordId, points, demo: status.isDemo } });
  return audit;
}

function matchTarget(results: ObservedListing[], b: { name: string; googlePlaceId: string | null }) {
  if (b.googlePlaceId) {
    const hit = results.find((r) => r.placeId === b.googlePlaceId);
    if (hit) return hit;
  }
  // Without a place id, only a near-exact name match counts; ambiguous matches are not claimed.
  const name = b.name.toLowerCase();
  return results.find((r) => r.name.toLowerCase() === name || textSimilarity(r.name, b.name) >= 0.85) ?? null;
}

/** Worker: observes every grid point. Re-running resumes, skipping points already observed. */
export async function executeAudit(auditId: string) {
  const [audit] = await db.select().from(rankingAudits).where(eq(rankingAudits.id, auditId)).limit(1);
  if (!audit || ["completed", "partial", "failed"].includes(audit.status)) return { skipped: true };
  const [cfg] = await db.select().from(auditConfigurations).where(eq(auditConfigurations.id, audit.configurationId)).limit(1);
  const [k] = await db.select().from(keywords).where(eq(keywords.id, cfg.keywordId)).limit(1);
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, audit.businessId)).limit(1);
  await db.update(rankingAudits).set({ status: "running", startedAt: audit.startedAt ?? new Date() }).where(eq(rankingAudits.id, audit.id));
  const provider = getRankingProvider({ name: b.name, placeId: b.googlePlaceId, lat: cfg.centerLat, lng: cfg.centerLng });
  if (provider.id !== audit.provider) {
    await db.update(rankingAudits).set({ status: "failed", error: `Provider changed from ${audit.provider} to ${provider.id}; start a new audit`, completedAt: new Date() }).where(eq(rankingAudits.id, audit.id));
    return { failed: true };
  }
  const grid = generateGrid({ lat: cfg.centerLat, lng: cfg.centerLng }, cfg.radiusKm, cfg.gridSize);
  const done = new Set((await db.select({ i: rankingObservations.pointIndex }).from(rankingObservations).where(eq(rankingObservations.auditId, audit.id))).map((r) => r.i));
  const query = k.city ? `${k.phrase} ${k.city}` : k.phrase;
  const todo = grid.filter((p) => !done.has(p.index));
  const CONCURRENCY = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const p = todo[cursor++];
      try {
        const res = await provider.searchAt({ keyword: query, lat: p.lat, lng: p.lng, language: cfg.language, device: cfg.device });
        const hit = matchTarget(res.results, b);
        await db
          .insert(rankingObservations)
          .values({ auditId: audit.id, pointIndex: p.index, lat: p.lat, lng: p.lng, status: hit ? "found" : "not_found", rank: hit?.rank ?? null, matchedPlaceId: hit?.placeId ?? null, results: res.results, providerRef: res.providerRef ?? null })
          .onConflictDoNothing();
      } catch (e) {
        await db.insert(rankingObservations).values({ auditId: audit.id, pointIndex: p.index, lat: p.lat, lng: p.lng, status: "failed", error: (e as Error).message.slice(0, 500) }).onConflictDoNothing();
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return finalizeAudit(audit.id);
}

export async function finalizeAudit(auditId: string) {
  const [audit] = await db.select().from(rankingAudits).where(eq(rankingAudits.id, auditId)).limit(1);
  const [cfg] = await db.select().from(auditConfigurations).where(eq(auditConfigurations.id, audit.configurationId)).limit(1);
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, audit.businessId)).limit(1);
  const obs = await db.select().from(rankingObservations).where(eq(rankingObservations.auditId, auditId));
  const stats = auditStats(obs.map((o) => ({ pointIndex: o.pointIndex, status: o.status, rank: o.rank })));
  const status = stats.succeeded === 0 ? "failed" : stats.failed > 0 ? "partial" : "completed";
  await db
    .update(rankingAudits)
    .set({ status, pointsSucceeded: stats.succeeded, stats: { ...stats }, completedAt: new Date(), error: status === "failed" ? (obs.find((o) => o.error)?.error ?? "All observations failed") : null })
    .where(eq(rankingAudits.id, auditId));
  if (!audit.isDemo && stats.succeeded) await recordUsage(b.orgId, b.id, "ranking_point", stats.succeeded, audit.provider);

  const targetPlace = b.googlePlaceId ?? obs.find((o) => o.matchedPlaceId)?.matchedPlaceId ?? null;
  const comps = aggregateCompetitors(obs, targetPlace).slice(0, 15);
  for (const c of comps) {
    const [row] = await db
      .insert(competitors)
      .values({ businessId: b.id, placeId: c.placeId, name: c.name, isDemo: audit.isDemo })
      .onConflictDoUpdate({ target: [competitors.businessId, competitors.placeId], set: { name: c.name, lastSeenAt: new Date() } })
      .returning();
    await db.insert(competitorSnapshots).values({ competitorId: row.id, auditId, keywordId: cfg.keywordId, appearances: c.appearances, averageRank: c.averageRank, top3Count: c.top3Count, rating: c.rating ?? null, reviewCount: c.reviewCount ?? null });
  }
  await notifyOrgUsers(b.orgId, b.id, { type: "audit.completed", title: `Ranking audit ${status === "failed" ? "failed" : "finished"}${audit.isDemo ? " (demo data)" : ""}`, body: status === "failed" ? undefined : `${stats.succeeded} of ${stats.points} points observed.`, link: `/b/${b.id}/rankings/${auditId}` });
  return { status, stats };
}

/* ---------------- Reading audits ---------------- */

export async function listAudits(actor: Actor, businessId: string, keywordId?: string) {
  await requireBusiness(actor, businessId);
  const conds = [eq(rankingAudits.businessId, businessId)];
  if (keywordId) conds.push(eq(auditConfigurations.keywordId, keywordId));
  return db
    .select({ audit: rankingAudits, config: auditConfigurations, keyword: keywords })
    .from(rankingAudits)
    .innerJoin(auditConfigurations, eq(auditConfigurations.id, rankingAudits.configurationId))
    .innerJoin(keywords, eq(keywords.id, auditConfigurations.keywordId))
    .where(and(...conds))
    .orderBy(desc(rankingAudits.createdAt))
    .limit(100);
}

export async function getAudit(actor: Actor, businessId: string, auditId: string) {
  await requireBusiness(actor, businessId);
  const [row] = await db
    .select({ audit: rankingAudits, config: auditConfigurations, keyword: keywords })
    .from(rankingAudits)
    .innerJoin(auditConfigurations, eq(auditConfigurations.id, rankingAudits.configurationId))
    .innerJoin(keywords, eq(keywords.id, auditConfigurations.keywordId))
    .where(and(eq(rankingAudits.id, auditId), eq(rankingAudits.businessId, businessId)))
    .limit(1);
  if (!row) throw notFound("Audit");
  const obs = await db.select().from(rankingObservations).where(eq(rankingObservations.auditId, auditId)).orderBy(asc(rankingObservations.pointIndex));

  // Compare with the previous finished audit for the same keyword. Only the same configuration version is point-comparable.
  const [prev] = await db
    .select({ audit: rankingAudits, config: auditConfigurations })
    .from(rankingAudits)
    .innerJoin(auditConfigurations, eq(auditConfigurations.id, rankingAudits.configurationId))
    .where(and(eq(auditConfigurations.keywordId, row.keyword.id), inArray(rankingAudits.status, ["completed", "partial"]), sql`${rankingAudits.createdAt} < ${row.audit.createdAt}`, eq(rankingAudits.isDemo, row.audit.isDemo)))
    .orderBy(desc(rankingAudits.createdAt))
    .limit(1);
  let comparison: (ReturnType<typeof compareAudits> & { previousAuditId: string; sameConfiguration: boolean }) | null = null;
  if (prev) {
    const sameConfiguration = prev.config.id === row.config.id;
    const prevObs = sameConfiguration ? await db.select().from(rankingObservations).where(eq(rankingObservations.auditId, prev.audit.id)) : [];
    const toObs = (o: typeof obs): Obs[] => o.map((x) => ({ pointIndex: x.pointIndex, status: x.status, rank: x.rank }));
    comparison = { ...compareAudits(toObs(prevObs), toObs(obs)), previousAuditId: prev.audit.id, sameConfiguration };
  }
  const comps = await db
    .select({ snap: competitorSnapshots, comp: competitors })
    .from(competitorSnapshots)
    .innerJoin(competitors, eq(competitors.id, competitorSnapshots.competitorId))
    .where(eq(competitorSnapshots.auditId, auditId))
    .orderBy(desc(competitorSnapshots.top3Count), desc(competitorSnapshots.appearances));
  return { ...row, observations: obs, comparison, competitors: comps };
}

export async function listCompetitors(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  const comps = await db.select().from(competitors).where(eq(competitors.businessId, businessId)).orderBy(desc(competitors.isTracked), desc(competitors.lastSeenAt)).limit(100);
  const snaps = comps.length
    ? await db.select().from(competitorSnapshots).where(inArray(competitorSnapshots.competitorId, comps.map((c) => c.id))).orderBy(desc(competitorSnapshots.capturedAt))
    : [];
  return comps.map((c) => {
    const mine = snaps.filter((s) => s.competitorId === c.id);
    return { ...c, latest: mine[0] ?? null, history: mine.slice(0, 12).reverse() };
  });
}

export async function setCompetitorTracked(actor: Actor, businessId: string, competitorId: string, tracked: boolean) {
  await requireBusiness(actor, businessId, "business.edit");
  const [c] = await db.update(competitors).set({ isTracked: tracked }).where(and(eq(competitors.id, competitorId), eq(competitors.businessId, businessId))).returning();
  if (!c) throw notFound("Competitor");
  return c;
}

/** Runs audits for the tracked keywords chosen in the automation (all tracked if none chosen). */
export async function runScheduledAudits(businessId: string, keywordIds: string[]) {
  const conds = [eq(keywords.businessId, businessId), eq(keywords.isTracked, true), isNull(keywords.archivedAt)];
  if (keywordIds.length) conds.push(inArray(keywords.id, keywordIds));
  const kws = await db.select().from(keywords).where(and(...conds)).orderBy(asc(keywords.priority)).limit(10);
  const started: string[] = [];
  const errors: string[] = [];
  for (const k of kws) {
    try {
      started.push((await startAudit(businessId, k.id, "schedule")).id);
    } catch (e) {
      errors.push(`${k.phrase}: ${(e as Error).message}`);
    }
  }
  return { started: started.length, errors };
}
