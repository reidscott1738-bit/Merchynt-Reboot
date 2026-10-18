import { describe, expect, it } from "vitest";
import { aggregateCompetitors, auditStats, compareAudits, rankBand, type Obs } from "@/lib/ranking-metrics";
import { generateGrid, haversineKm } from "@/lib/geo";

describe("ranking metrics", () => {
  const obs: Obs[] = [
    { pointIndex: 0, status: "found", rank: 1 },
    { pointIndex: 1, status: "found", rank: 5 },
    { pointIndex: 2, status: "not_found", rank: null },
    { pointIndex: 3, status: "failed", rank: null },
  ];
  it("keeps failed points out of every ranking statistic", () => {
    const s = auditStats(obs);
    expect(s).toMatchObject({ points: 4, succeeded: 3, failed: 1, found: 2, averageRank: 3 });
    expect(s.coverage).toBe(0.75);
    expect(s.top3Share).toBeCloseTo(1 / 3);
    expect(s.notFoundShare).toBeCloseTo(1 / 3);
  });
  it("returns null shares when nothing succeeded", () => {
    expect(auditStats([{ pointIndex: 0, status: "failed", rank: null }])).toMatchObject({ averageRank: null, top3Share: null, coverage: 0 });
  });
  it("compares runs point by point and treats failures as incomparable", () => {
    const cur: Obs[] = [
      { pointIndex: 0, status: "found", rank: 2 },
      { pointIndex: 1, status: "found", rank: 3 },
      { pointIndex: 2, status: "found", rank: 15 },
      { pointIndex: 3, status: "found", rank: 1 },
    ];
    const c = compareAudits(obs, cur);
    expect(c).toMatchObject({ improved: 2, worsened: 1, incomparable: 1, comparable: 3 });
    expect(c.averageRankChange).toBe(-0.5);
  });
  it("bands ranks", () => {
    expect(rankBand({ status: "found", rank: 3 })).toBe("top3");
    expect(rankBand({ status: "found", rank: 11 })).toBe("top20");
    expect(rankBand({ status: "not_found", rank: null })).toBe("beyond");
    expect(rankBand({ status: "failed", rank: null })).toBe("failed");
  });
  it("aggregates competitors and excludes the business itself", () => {
    const agg = aggregateCompetitors(
      [
        { status: "found", results: [{ placeId: "me", name: "Me", rank: 1 }, { placeId: "a", name: "A", rank: 2 }, { placeId: "b", name: "B", rank: 5 }] },
        { status: "found", results: [{ placeId: "a", name: "A", rank: 4 }] },
        { status: "failed", results: [{ placeId: "c", name: "C", rank: 1 }] },
      ],
      "me",
    );
    expect(agg.map((x) => x.placeId)).toEqual(["a", "b"]);
    expect(agg[0]).toMatchObject({ appearances: 2, averageRank: 3, top3Count: 1 });
  });
});

describe("grid", () => {
  it("builds a deterministic odd grid centered on the business", () => {
    const g = generateGrid({ lat: 30.2672, lng: -97.7431 }, 5, 5);
    expect(g).toHaveLength(25);
    expect(g[12]).toMatchObject({ row: 2, col: 2, lat: 30.2672, lng: -97.7431 });
    expect(haversineKm(g[12], g[14])).toBeCloseTo(5, 1);
    expect(generateGrid({ lat: 30.2672, lng: -97.7431 }, 5, 5)).toEqual(g);
  });
  it("rejects invalid sizes", () => {
    expect(() => generateGrid({ lat: 0, lng: 0 }, 5, 4)).toThrow();
    expect(() => generateGrid({ lat: 0, lng: 0 }, 0, 5)).toThrow();
  });
});
