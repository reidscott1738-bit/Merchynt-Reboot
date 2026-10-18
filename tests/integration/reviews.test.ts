import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { publicationJobs, reviewReplies, reviews, tasks } from "@/server/db/schema";
import "@/server/services/register";
import { processReviews, savePolicies } from "@/server/services/reviews";
import { closeDb, makeBusiness, makeOrg, resetDb } from "./helpers";

beforeAll(resetDb);
afterAll(closeDb);

describe("review automation", () => {
  it("applies per-star rules: auto for 5 stars, escalated approval for 1 star", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    await savePolicies(owner, b.id, [
      { rating: 5, mode: "auto" },
      { rating: 4, mode: "approval" },
      { rating: 3, mode: "ignore" },
      { rating: 2, mode: "approval", escalate: true },
      { rating: 1, mode: "approval", escalate: true },
    ]);
    const now = new Date();
    const [r5, r3, r1] = await db
      .insert(reviews)
      .values([
        { businessId: b.id, source: "demo", externalId: "r5", rating: 5, text: "Fast and friendly, fixed our leak.", reviewerName: "Sam Lee", publishedAt: now, isDemo: true },
        { businessId: b.id, source: "demo", externalId: "r3", rating: 3, text: "It was okay.", reviewerName: "Kim", publishedAt: now, isDemo: true },
        { businessId: b.id, source: "demo", externalId: "r1", rating: 1, text: "Nobody showed up.", reviewerName: "Ari", publishedAt: now, isDemo: true },
      ])
      .returning();
    const out = await processReviews(b.id, { mode: "new" });
    expect(out.tally).toMatchObject({ escalated: 1, ignored: 1 });
    const get = async (id: string) => (await db.select().from(reviews).where(eq(reviews.id, id)))[0];
    expect((await get(r3.id)).replyStatus).toBe("ignored");
    expect((await get(r1.id)).replyStatus).toBe("escalated");
    const [t] = await db.select().from(tasks).where(eq(tasks.businessId, b.id));
    expect(t.title).toMatch(/^Escalated/);

    const five = await get(r5.id);
    const [reply5] = await db.select().from(reviewReplies).where(eq(reviewReplies.reviewId, r5.id));
    expect(reply5.validation?.ok).toBe(true);
    expect(out.tally.auto_published).toBe(1);
    const [pub] = await db.select().from(publicationJobs).where(eq(publicationJobs.refId, reply5.id));
    expect(pub.destination).toBe("google");
    expect(five.replyStatus).toBe("publishing");
  });

  it("does not draft twice for a review already being handled", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    await db.insert(reviews).values({ businessId: b.id, source: "demo", externalId: "x", rating: 4, text: "Good work overall.", publishedAt: new Date(), isDemo: true });
    const [a, c] = await Promise.all([processReviews(b.id, { mode: "new" }), processReviews(b.id, { mode: "new" })]);
    const replies = await db.select().from(reviewReplies).where(eq(reviewReplies.businessId, b.id));
    expect(replies).toHaveLength(1);
    expect([...a.results, ...c.results].filter((r) => r.action === "awaiting_approval")).toHaveLength(1);
  });

  it("skips reviews that already have an owner reply", async () => {
    const owner = await makeOrg();
    const b = await makeBusiness(owner);
    await db.insert(reviews).values({ businessId: b.id, source: "demo", externalId: "y", rating: 2, text: "Meh.", ownerReply: "Sorry to hear that.", publishedAt: new Date(), isDemo: true });
    const out = await processReviews(b.id, { mode: "new" });
    expect(out.processed).toBe(0);
  });
});
