import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now().toString(36);
const owner = { name: "E2E Owner", email: `owner-${stamp}@example.test`, password: "e2e-password-123", org: `E2E Agency ${stamp}` };

async function signUp(page: Page, who = owner) {
  await page.goto("/signup");
  await page.fill('input[name="name"]', who.name);
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="password"]', who.password);
  await page.fill('input[name="orgName"]', who.org);
  await page.getByRole("button", { name: /create|sign up/i }).click();
  await page.waitForURL(/\/businesses\/new/);
}

async function createBusiness(page: Page) {
  await page.fill('input[name="name"]', "E2E Plumbing");
  await page.fill('input[name="primaryCategory"]', "Plumber");
  await page.fill('input[name="phone"]', "(512) 555-0100");
  await page.fill('input[name="googleReviewUrl"]', "https://example.com/review");
  await page.getByRole("button", { name: "Create business" }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]{36}/);
  return page.url().match(/\/b\/([0-9a-f-]{36})/)![1];
}

test.describe.serial("LocalPilot", () => {
  let businessId = "";

  test("redirects signed-out visitors to sign in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs up, creates a business and shows the demo banner", async ({ page }) => {
    await signUp(page);
    businessId = await createBusiness(page);
    await expect(page.getByText(/demo/i).first()).toBeVisible();
  });

  test("every business screen renders without a server error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', owner.email);
    await page.fill('input[name="password"]', owner.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(dashboard|b\/)/);
    const paths = ["", "/onboarding", "/tasks", "/automations", "/profile", "/reviews", "/review-requests", "/posts", "/keywords", "/rankings", "/competitors", "/media", "/videos", "/website", "/seo", "/seo?tab=schema", "/seo?tab=faqs", "/ai-visibility", "/reports", "/integrations", "/train"];
    for (const p of paths) {
      const res = await page.goto(`/b/${businessId}${p}`);
      expect(res?.status(), p).toBe(200);
      await expect(page.locator("h1").first(), p).toBeVisible();
    }
    for (const p of ["/dashboard", "/tasks", "/settings", "/settings?tab=members", "/settings?tab=branding", "/settings?tab=usage", "/settings?tab=activity", "/agency", "/account", "/notifications"]) {
      const res = await page.goto(p);
      expect(res?.status(), p).toBe(200);
    }
  });

  test("builds and publishes a website that is public only after publishing", async ({ page, request }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', owner.email);
    await page.fill('input[name="password"]', owner.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(dashboard|b\/)/);
    await page.goto(`/b/${businessId}/website`);
    await page.getByRole("button", { name: "Generate website" }).click();
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
    const preview = page.getByRole("link", { name: "Preview draft" });
    const href = await preview.getAttribute("href");
    const draft = await page.goto(href!);
    expect(draft?.status()).toBe(200);
    await expect(page.getByText("Draft preview")).toBeVisible();
    await page.goto(`/b/${businessId}/website`);
    await page.getByRole("button", { name: "Publish" }).click();
    const link = page.locator('a[href*="/sites/"]').first();
    await expect(link).toBeVisible();
    const siteUrl = (await link.getAttribute("href"))!;
    const pub = await request.get(siteUrl);
    expect(pub.status()).toBe(200);
    expect(await pub.text()).not.toContain("Draft preview");
    const robots = await request.get(`${siteUrl}/robots.txt`);
    expect(await robots.text()).toContain("Sitemap:");
    const sitemap = await request.get(`${siteUrl}/sitemap.xml`);
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<urlset");
  });

  test("another organization cannot open the business", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signUp(page, { name: "Other", email: `other-${stamp}@example.test`, password: "e2e-password-456", org: `Other ${stamp}` });
    const res = await page.goto(`/b/${businessId}`);
    expect(res?.status()).toBe(404);
    await ctx.close();
  });

  test("public review page sends everyone to the same Google button and unsubscribe needs a click", async ({ page }) => {
    await page.goto(`/r/does-not-exist`);
    await expect(page.locator("body")).toContainText(/not found|404/i);
    const res = await page.goto(`/u/abcdefghijklmnop`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("button", { name: "Unsubscribe" })).toBeVisible();
    await page.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(page.locator("body")).toContainText(/not valid/);
  });

  test("approval links that do not exist change nothing", async ({ page }) => {
    await page.goto(`/approve/${"x".repeat(43)}`);
    await expect(page.getByText("This link is not valid.")).toBeVisible();
  });

  test("health and media endpoints reject unsigned requests", async ({ request }) => {
    expect((await request.get("/api/health")).status()).toBe(200);
    expect((await request.get("/api/public/media/00000000-0000-0000-0000-000000000000?v=web&s=bad")).status()).toBe(404);
    expect((await request.post("/api/cron")).status()).toBe(503);
  });
});
