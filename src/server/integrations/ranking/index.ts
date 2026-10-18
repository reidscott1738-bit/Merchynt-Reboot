import { createHash } from "node:crypto";
import { env } from "../../env";
import { httpJson } from "../http";
import { notConfigured } from "../../errors";
import type { ObservedListing } from "../../db/schema";

/**
 * Ranking data provider contract. A provider returns the local-pack/maps
 * results for one query at one coordinate. Swapping providers does not change
 * audit storage or statistics.
 */
export interface RankingProvider {
  readonly id: string;
  readonly label: string;
  readonly isDemo: boolean;
  readonly depth: number;
  searchAt(input: { keyword: string; lat: number; lng: number; language: string; device: "desktop" | "mobile" }): Promise<{ results: ObservedListing[]; providerRef?: string }>;
  searchVolume?(keywords: string[], location: { lat: number; lng: number } | null): Promise<{ keyword: string; volume: number | null }[]>;
}

type DfsMapsItem = { type: string; rank_absolute: number; title: string; place_id?: string; cid?: string; address?: string; rating?: { value?: number; votes_count?: number } };

class DataForSeoProvider implements RankingProvider {
  readonly id = "dataforseo";
  readonly label = "DataForSEO Google Maps SERP";
  readonly isDemo = false;
  readonly depth = 20;
  constructor(private login: string, private password: string) {}
  private headers() {
    return { authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}` };
  }
  async searchAt(input: { keyword: string; lat: number; lng: number; language: string; device: "desktop" | "mobile" }) {
    type Res = { tasks?: { id: string; status_code: number; status_message: string; result?: { items?: DfsMapsItem[] }[] }[] };
    const res = await httpJson<Res>("https://api.dataforseo.com/v3/serp/google/maps/live/advanced", {
      method: "POST",
      headers: this.headers(),
      timeoutMs: 60_000,
      body: [{ keyword: input.keyword, location_coordinate: `${input.lat},${input.lng},15z`, language_code: input.language, device: input.device, depth: this.depth }],
    });
    const task = res.tasks?.[0];
    if (!task || task.status_code >= 40000) throw new Error(`DataForSEO: ${task?.status_message ?? "no task returned"}`);
    const items = task.result?.[0]?.items ?? [];
    return {
      providerRef: task.id,
      results: items
        .filter((i) => i.type === "maps_search")
        .map((i) => ({ placeId: i.place_id ?? i.cid ?? i.title, name: i.title, rank: i.rank_absolute, rating: i.rating?.value, reviewCount: i.rating?.votes_count, address: i.address })),
    };
  }
  async searchVolume(keywords: string[], location: { lat: number; lng: number } | null) {
    type Res = { tasks?: { status_code: number; status_message: string; result?: { keyword: string; search_volume: number | null }[] }[] };
    const res = await httpJson<Res>("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
      method: "POST",
      headers: this.headers(),
      timeoutMs: 60_000,
      body: [{ keywords, language_code: "en", ...(location ? { location_coordinate: `${location.lat},${location.lng}` } : { location_code: 2840 }) }],
    });
    const task = res.tasks?.[0];
    if (!task || task.status_code >= 40000) throw new Error(`DataForSEO: ${task?.status_message ?? "no task returned"}`);
    return (task.result ?? []).map((r) => ({ keyword: r.keyword, volume: r.search_volume }));
  }
}

/**
 * Synthetic provider for demos and tests. Results are deterministic per
 * (keyword, point) and every audit it produces is stored with is_demo = true.
 */
export class DemoRankingProvider implements RankingProvider {
  readonly id = "demo";
  readonly label = "Demo data (synthetic, not real rankings)";
  readonly isDemo = true;
  readonly depth = 20;
  constructor(private target: { name: string; placeId: string; lat: number; lng: number }) {}
  async searchAt(input: { keyword: string; lat: number; lng: number }) {
    const h = createHash("sha256").update(`${input.keyword}|${input.lat.toFixed(4)}|${input.lng.toFixed(4)}`).digest();
    if (h[0] < 8) throw new Error("Demo provider: simulated observation failure");
    const distKm = Math.hypot((input.lat - this.target.lat) * 111, (input.lng - this.target.lng) * 85);
    const base = 1 + Math.floor(distKm * 1.6 + (h[1] % 5));
    const names = ["Demo Competitor Alpha", "Demo Competitor Bravo", "Demo Competitor Charlie", "Demo Competitor Delta", "Demo Competitor Echo", "Demo Competitor Foxtrot", "Demo Competitor Golf"];
    const results: ObservedListing[] = [];
    const targetRank = base <= this.depth ? base : null;
    let r = 1;
    for (let i = 0; results.length < this.depth && i < 40; i++) {
      if (targetRank === r) {
        results.push({ placeId: this.target.placeId, name: this.target.name, rank: r++ });
        continue;
      }
      const n = names[(h[2 + (i % 20)] + i) % names.length];
      if (results.some((x) => x.name === n)) {
        results.push({ placeId: `demo-other-${i}`, name: `Demo Listing ${i + 1}`, rank: r++ });
      } else {
        results.push({ placeId: `demo-${n.toLowerCase().replace(/\s+/g, "-")}`, name: n, rank: r++, rating: 3.8 + (h[i % 32] % 12) / 10, reviewCount: 20 + h[(i + 3) % 32] });
      }
    }
    return { results, providerRef: `demo-${h.toString("hex").slice(0, 10)}` };
  }
  async searchVolume() {
    return [];
  }
}

export function rankingProviderStatus() {
  const e = env();
  if (e.DATAFORSEO_LOGIN && e.DATAFORSEO_PASSWORD) return { configured: true, id: "dataforseo", label: "DataForSEO", isDemo: false };
  if (e.DEMO_MODE) return { configured: true, id: "demo", label: "Demo data (synthetic)", isDemo: true };
  return { configured: false, id: "none", label: "Not configured", isDemo: false };
}

export function getRankingProvider(target: { name: string; placeId: string | null; lat: number; lng: number }): RankingProvider {
  const e = env();
  if (e.DATAFORSEO_LOGIN && e.DATAFORSEO_PASSWORD) return new DataForSeoProvider(e.DATAFORSEO_LOGIN, e.DATAFORSEO_PASSWORD);
  if (e.DEMO_MODE) return new DemoRankingProvider({ name: target.name, placeId: target.placeId ?? "demo-target", lat: target.lat, lng: target.lng });
  throw notConfigured("No ranking data provider is configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD, or enable DEMO_MODE for synthetic sample data.");
}
