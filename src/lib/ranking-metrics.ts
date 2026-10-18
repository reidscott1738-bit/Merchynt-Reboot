/**
 * Ranking statistics. Failed observations are tracked separately and are never
 * counted as ranking losses. "not_found" means the provider returned results
 * but the business was not in them (rank worse than the provider depth).
 */
export type Obs = { pointIndex: number; status: "found" | "not_found" | "failed"; rank: number | null };

export type AuditStats = {
  points: number;
  succeeded: number;
  failed: number;
  coverage: number; // succeeded / points
  found: number;
  averageRank: number | null; // over found points only
  top3Share: number | null; // share of succeeded points ranking 1-3
  top10Share: number | null;
  notFoundShare: number | null;
};

export function auditStats(obs: Obs[]): AuditStats {
  const points = obs.length;
  const succeeded = obs.filter((o) => o.status !== "failed");
  const found = succeeded.filter((o) => o.status === "found" && o.rank != null);
  const n = succeeded.length;
  const share = (k: number) => (n === 0 ? null : k / n);
  return {
    points,
    succeeded: n,
    failed: points - n,
    coverage: points === 0 ? 0 : n / points,
    found: found.length,
    averageRank: found.length ? round2(found.reduce((s, o) => s + (o.rank as number), 0) / found.length) : null,
    top3Share: share(found.filter((o) => (o.rank as number) <= 3).length),
    top10Share: share(found.filter((o) => (o.rank as number) <= 10).length),
    notFoundShare: share(succeeded.filter((o) => o.status === "not_found").length),
  };
}

export type PointChange = "improved" | "worsened" | "unchanged" | "incomparable";

/** Treats not_found as rank = depth+1 for direction only, never for averages. */
export function comparePoint(prev: Obs | undefined, cur: Obs | undefined, depth = 20): PointChange {
  if (!prev || !cur || prev.status === "failed" || cur.status === "failed") return "incomparable";
  const p = prev.status === "found" && prev.rank != null ? prev.rank : depth + 1;
  const c = cur.status === "found" && cur.rank != null ? cur.rank : depth + 1;
  if (c < p) return "improved";
  if (c > p) return "worsened";
  return "unchanged";
}

export type AuditComparison = {
  comparable: number;
  improved: number;
  worsened: number;
  unchanged: number;
  incomparable: number;
  improvedShare: number | null;
  worsenedShare: number | null;
  averageRankChange: number | null; // negative = better; over points found in both runs
  top3ShareChange: number | null;
};

export function compareAudits(prev: Obs[], cur: Obs[], depth = 20): AuditComparison {
  const prevByIdx = new Map(prev.map((o) => [o.pointIndex, o]));
  let improved = 0, worsened = 0, unchanged = 0, incomparable = 0;
  const deltas: number[] = [];
  for (const c of cur) {
    const p = prevByIdx.get(c.pointIndex);
    const change = comparePoint(p, c, depth);
    if (change === "improved") improved++;
    else if (change === "worsened") worsened++;
    else if (change === "unchanged") unchanged++;
    else incomparable++;
    if (p?.status === "found" && c.status === "found" && p.rank != null && c.rank != null) deltas.push(c.rank - p.rank);
  }
  const comparable = improved + worsened + unchanged;
  const a = auditStats(prev);
  const b = auditStats(cur);
  return {
    comparable,
    improved,
    worsened,
    unchanged,
    incomparable,
    improvedShare: comparable ? improved / comparable : null,
    worsenedShare: comparable ? worsened / comparable : null,
    averageRankChange: deltas.length ? round2(deltas.reduce((s, d) => s + d, 0) / deltas.length) : null,
    top3ShareChange: a.top3Share != null && b.top3Share != null ? round2(b.top3Share - a.top3Share) : null,
  };
}

export function rankBand(o: { status: string; rank: number | null }): "top3" | "top10" | "top20" | "beyond" | "failed" {
  if (o.status === "failed") return "failed";
  if (o.status !== "found" || o.rank == null) return "beyond";
  if (o.rank <= 3) return "top3";
  if (o.rank <= 10) return "top10";
  if (o.rank <= 20) return "top20";
  return "beyond";
}

export type CompetitorAggregate = { placeId: string; name: string; appearances: number; averageRank: number; top3Count: number; rating?: number; reviewCount?: number };

/** Competitors observed in the result lists of an audit, ranked by presence. */
export function aggregateCompetitors(
  observations: { status: string; results: { placeId: string; name: string; rank: number; rating?: number; reviewCount?: number }[] | null }[],
  excludePlaceId: string | null,
): CompetitorAggregate[] {
  const map = new Map<string, { name: string; ranks: number[]; rating?: number; reviewCount?: number }>();
  for (const o of observations) {
    if (o.status === "failed" || !o.results) continue;
    for (const r of o.results) {
      if (excludePlaceId && r.placeId === excludePlaceId) continue;
      const e = map.get(r.placeId) ?? { name: r.name, ranks: [] };
      e.ranks.push(r.rank);
      e.rating = r.rating ?? e.rating;
      e.reviewCount = r.reviewCount ?? e.reviewCount;
      map.set(r.placeId, e);
    }
  }
  return [...map.entries()]
    .map(([placeId, e]) => ({
      placeId,
      name: e.name,
      appearances: e.ranks.length,
      averageRank: round2(e.ranks.reduce((s, r) => s + r, 0) / e.ranks.length),
      top3Count: e.ranks.filter((r) => r <= 3).length,
      rating: e.rating,
      reviewCount: e.reviewCount,
    }))
    .sort((a, b) => b.top3Count - a.top3Count || b.appearances - a.appearances || a.averageRank - b.averageRank);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
