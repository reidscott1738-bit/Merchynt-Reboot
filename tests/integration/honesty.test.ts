import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { contentItems, publicationJobs, reviews } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import "@/server/services/register";
import { createManualPost } from "@/server/services/posts";
import { runPublication } from "@/server/services/publishing";
import { liveData } from "@/server/services/websites";
import { buildSchemaForBusiness } from "@/server/services/seo";
import { closeDb, makeBusiness, makeOrg, resetDb } from "./helpers";

beforeAll(resetDb);
afterAll(closeDb);
afterEach(() => {
  process.env.DEMO_MODE = "true";
  resetEnvCache();
});

async function publishedPost() {
  const owner = await makeOrg();
  const b = await makeBusiness(owner);
  const item = await createManualPost(owner, b.id, { body: "Spring tune-ups for outdoor faucets are open now in Austin.", ctaType: "CALL", destinations: ["google"] });
  const [pub] = await db.select().from(publicationJobs).where(and(eq(publicationJobs.refType, "content_item"), eq(publicationJobs.refId, item.id)));
  return { owner, b, item, pub };
}

describe("demo data is never presented as real", () => {
  it("records demo publications without a provider id or link", async () => {
    const { item, pub } = await publishedPost();
    await runPublication(pub.id, 1, false);
    const [after] = await db.select().from(publicationJobs).where(eq(publicationJobs.id, pub.id));
    expect(after).toMatchObject({ status: "succeeded", isDemo: true, providerId: null, providerUrl: null });
    const [ci] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
    expect(ci.status).toBe("published");
  });

  it("blocks instead of pretending when demo mode is off and Google is not connected", async () => {
    process.env.DEMO_MODE = "false";
    resetEnvCache();
    const { pub } = await publishedPost();
    const r = await runPublication(pub.id, 1, false);
    expect(r).toMatchObject({ blocked: expect.stringMatching(/not connected/) });
    const [after] = await db.select().from(publicationJobs).where(eq(publicationJobs.id, pub.id));
    expect(after.status).toBe("blocked");
    expect(after.providerId).toBeNull();
  });

  it("keeps demo reviews and demo-published posts off public websites", async () => {
    const { b, pub } = await publishedPost();
    await runPublication(pub.id, 1, false);
    await db.insert(reviews).values([
      { businessId: b.id, source: "demo", externalId: "d1", rating: 5, text: "Demo review text that is long enough to show.", publishedAt: new Date(), isDemo: true, reviewerName: "Demo Person" },
      { businessId: b.id, source: "google", externalId: "g1", rating: 5, text: "Real review text that is long enough to show.", publishedAt: new Date(), isDemo: false, reviewerName: "Real Person" },
    ]);
    const pub_ = await liveData(b.id, [], "https://site.example");
    expect(pub_.reviews.map((r) => r.name)).toEqual(["Real Person"]);
    expect(pub_.posts).toHaveLength(0);
    const preview = await liveData(b.id, [], "https://site.example", { includeDemo: true });
    expect(preview.reviews.find((r) => r.name === "Demo Person")?.isDemo).toBe(true);
    expect(preview.posts).toHaveLength(1);
  });

  it("leaves demo reviews out of the rating in structured data", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    await db.insert(reviews).values(Array.from({ length: 6 }, (_, i) => ({ businessId: b.id, source: "demo" as const, externalId: `d${i}`, rating: 5, text: "x", publishedAt: new Date(), isDemo: true })));
    const { doc } = await buildSchemaForBusiness(b.id);
    expect(doc.aggregateRating).toBeUndefined();
  });
});
