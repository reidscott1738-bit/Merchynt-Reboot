import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import exifr from "exifr";
import { rm } from "node:fs/promises";
import { db } from "@/server/db";
import { creditLedger, mediaVariants, suppressions } from "@/server/db/schema";
import { ingestMedia } from "@/server/services/media";
import { storage } from "@/server/storage";
import { addContact, createCampaign, DEFAULT_CAMPAIGN, getPublicReviewPage, optOut } from "@/server/services/campaigns";
import { creditBalance, grantCredits, requestReport } from "@/server/services/reports";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { claimJobs, enqueue } from "@/server/jobs/queue";
import { closeDb, makeBusiness, makeOrg, resetDb } from "./helpers";

beforeAll(resetDb);
afterAll(async () => {
  await rm("./storage-test", { recursive: true, force: true });
  await closeDb();
});

async function gpsJpeg(color = "#3366cc") {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
    .jpeg()
    .withExif({ IFD0: { Make: "Cam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "30/1 16/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "97/1 44/1 0/1" } })
    .toBuffer();
}

describe("media", () => {
  it("reads camera GPS when present and strips all metadata from public variants", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    const { asset } = await ingestMedia({ businessId: b.id, data: await gpsJpeg(), filename: "job.jpg", source: "upload" });
    expect(asset.exifLat).toBeCloseTo(30.2667, 3);
    expect(asset.exifLng).toBeCloseTo(-97.7333, 3);
    const variants = await db.select().from(mediaVariants).where(eq(mediaVariants.assetId, asset.id));
    expect(variants.map((v) => v.variant).sort()).toEqual(["square", "thumb", "web"]);
    for (const v of variants) {
      const meta = await exifr.parse(await storage().get(v.storageKey), { gps: true }).catch(() => undefined);
      expect(meta?.latitude).toBeUndefined();
    }
  });
  it("does not invent a location for photos without GPS and de-duplicates uploads", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    const plain = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const first = await ingestMedia({ businessId: b.id, data: plain, filename: "a.png", source: "upload" });
    expect(first.asset.exifLat).toBeNull();
    const again = await ingestMedia({ businessId: b.id, data: plain, filename: "b.png", source: "upload" });
    expect(again).toMatchObject({ duplicate: true, asset: { id: first.asset.id } });
  });
  it("rejects files that are not media", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    await expect(ingestMedia({ businessId: b.id, data: Buffer.from("<script>alert(1)</script>"), filename: "x.jpg", source: "upload" })).rejects.toThrow(/Unsupported file type/);
  });
});

describe("review requests", () => {
  it("opting out suppresses the address for every campaign in the org", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    const c1 = await createCampaign(owner, b.id, { ...DEFAULT_CAMPAIGN, name: "One" });
    const c2 = await createCampaign(owner, b.id, { ...DEFAULT_CAMPAIGN, name: "Two" });
    const contact = await addContact(owner, b.id, c1.id, { email: "Pat@Example.com", name: "Pat" });
    expect(await optOut(contact.optOutToken)).toEqual({ businessName: b.name });
    const [s] = await db.select().from(suppressions).where(eq(suppressions.orgId, owner.orgId));
    expect(s.emailNormalized).toBe("pat@example.com");
    const later = await addContact(owner, b.id, c2.id, { email: "pat@example.com" });
    expect(later.status).toBe("suppressed");
    expect(await optOut("not-a-real-token-xyz")).toBeNull();
  });
  it("shows every visitor the same review page", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    const page = await getPublicReviewPage(b.reviewSlug);
    expect(page?.business.googleReviewUrl).toBe("https://g.page/r/example/review");
    expect(await getPublicReviewPage("no-such-business")).toBeNull();
  });
});

describe("report credits", () => {
  it("refuses on-demand reports without credits and charges exactly once under concurrency", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    const period = { start: "2026-09-01", end: "2026-09-30" };
    await expect(requestReport({ businessId: b.id, period, type: "on_demand" }, owner)).rejects.toThrow(/balance is 0/);
    await grantCredits(owner, 1, "test");
    const results = await Promise.allSettled([1, 2, 3].map(() => requestReport({ businessId: b.id, period, type: "on_demand" }, owner)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await creditBalance(owner.orgId)).toBe(0);
    const charges = await db.select().from(creditLedger).where(and(eq(creditLedger.orgId, owner.orgId), eq(creditLedger.reason, "report_charge")));
    expect(charges).toHaveLength(1);
  });
  it("only owners can grant credits", async () => {
    const owner = await makeOrg();
    await expect(grantCredits({ ...owner, role: "admin" }, 5)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("infrastructure", () => {
  it("rate limits per key within a window", async () => {
    for (let i = 0; i < 3; i++) await consumeRateLimit("test:key", 3, 60);
    await expect(consumeRateLimit("test:key", 3, 60)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(consumeRateLimit("test:other", 3, 60)).resolves.toBe(1);
  });
  it("enqueues idempotently and never hands one job to two workers", async () => {
    const a = await enqueue("noop", {}, { idempotencyKey: "same-key" });
    const b = await enqueue("noop", {}, { idempotencyKey: "same-key" });
    expect(b).toMatchObject({ created: false, job: { id: a.job.id } });
    for (let i = 0; i < 10; i++) await enqueue("noop", { i });
    const [w1, w2] = await Promise.all([claimJobs("w1", 8), claimJobs("w2", 8)]);
    const claimed = [...w1, ...w2];
    const ids = claimed.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(claimed.filter((j) => j.name === "noop")).toHaveLength(11);
  });
});

