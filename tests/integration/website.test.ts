import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { websitePages, websites } from "@/server/db/schema";
import { generateWebsite, getDraftSite, getPublishedSite, publishWebsite, regenerateSection, updateSection, unpublishWebsite } from "@/server/services/websites";
import { closeDb, makeBusiness, makeOrg, resetDb } from "./helpers";

beforeAll(resetDb);
afterAll(closeDb);

async function siteFor() {
  const owner = await makeOrg();
  const b = await makeBusiness(owner);
  const site = await generateWebsite(owner, b.id);
  const pages = await db.select().from(websitePages).where(eq(websitePages.websiteId, site.id)).orderBy(asc(websitePages.position));
  return { owner, b, site, pages };
}

describe("website builder", () => {
  it("generates a multi-page draft that is not public until published", async () => {
    const { b, site, pages } = await siteFor();
    expect(pages.map((p) => p.path)).toContain("/");
    expect(pages.length).toBeGreaterThan(3);
    expect(await getPublishedSite({ slug: site.slug })).toBeNull();
    expect((await getDraftSite((await makeOrg()), b.id).catch((e) => e)).code).toBe("not_found");
  });

  it("keeps manual edits when a section is regenerated", async () => {
    const { owner, b, pages } = await siteFor();
    const home = pages.find((p) => p.path === "/")!;
    const hero = home.sections.find((s) => s.type === "hero")!;
    await updateSection(owner, b.id, home.id, hero.id, { heading: "Our own words" });
    const r = await regenerateSection(owner, b.id, home.id, hero.id);
    expect(r.preserved).toContain("heading");
    expect(r.section.data.heading).toBe("Our own words");
    const over = await regenerateSection(owner, b.id, home.id, hero.id, { overwriteManual: true });
    expect(over.regenerated).toContain("heading");
    expect(over.section.manualFields ?? []).not.toContain("heading");
  });

  it("publishes a snapshot; later draft edits do not change the live site", async () => {
    const { owner, b, site, pages } = await siteFor();
    const res = await publishWebsite(owner, b.id);
    expect(res.published, JSON.stringify(res.checks)).toBe(true);
    const home = pages.find((p) => p.path === "/")!;
    const hero = home.sections.find((s) => s.type === "hero")!;
    await updateSection(owner, b.id, home.id, hero.id, { heading: "Draft only change" });
    const live = await getPublishedSite({ slug: site.slug });
    const liveHero = live!.pages.find((p) => p.path === "/")!.sections.find((s) => s.type === "hero")!;
    expect(liveHero.data.heading).not.toBe("Draft only change");
    await unpublishWebsite(owner, b.id);
    expect(await getPublishedSite({ slug: site.slug })).toBeNull();
  });

  it("blocks publishing content with unverified claims", async () => {
    const { owner, b, pages } = await siteFor();
    const home = pages.find((p) => p.path === "/")!;
    const hero = home.sections.find((s) => s.type === "hero")!;
    await updateSection(owner, b.id, home.id, hero.id, { heading: "Award-winning 24/7 plumbers" });
    const res = await publishWebsite(owner, b.id);
    expect(res.published).toBe(false);
    expect(JSON.stringify(res.checks)).toMatch(/award|24\/7/i);
    const [s] = await db.select().from(websites).where(eq(websites.businessId, b.id));
    expect(s.publishedRevisionId).toBeNull();
  });
});
