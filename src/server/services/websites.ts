import { randomUUID } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  businessLocations,
  businessServices,
  contentItems,
  customDomains,
  faqs,
  mediaAssets,
  reviews,
  websiteDeployments,
  websitePages,
  websiteRevisions,
  websites,
  type SiteSection,
  type ValidationIssue,
} from "../db/schema";
import { assertCan, requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { invalid, notFound } from "../errors";
import { randomToken } from "../security/crypto";
import { loadBusinessContext, type BusinessContext } from "../ai/context";
import { generateWebsiteCopy, regenerateSectionCopy } from "../ai/tasks";
import { PLATFORM_LIMITS, validateContent } from "@/lib/content-validation";
import { slugify, truncate } from "@/lib/text";
import { env } from "../env";
import { recordAiUsage } from "./usage";
import { buildSchemaForBusiness } from "./seo";

export type Website = typeof websites.$inferSelect;
export type WebsitePage = typeof websitePages.$inferSelect;
type PageType = WebsitePage["type"];

/** Section types and which fields are generated copy (and therefore regenerable). */
export const SECTION_TYPES: Record<string, { label: string; copyFields: string[]; live?: string }> = {
  hero: { label: "Hero", copyFields: ["heading", "body"] },
  text: { label: "Text", copyFields: ["heading", "body"] },
  services_list: { label: "Services list", copyFields: ["heading"], live: "Active services from the business profile" },
  service_detail: { label: "Service detail", copyFields: ["heading", "body"] },
  areas: { label: "Service areas", copyFields: ["heading", "body"], live: "Service areas from the business profile" },
  reviews_widget: { label: "Reviews", copyFields: ["heading"], live: "Recent 4 and 5 star reviews synced from Google" },
  gallery: { label: "Photo gallery", copyFields: ["heading"], live: "Approved photos marked for website use" },
  faqs: { label: "FAQs", copyFields: ["heading"], live: "Approved FAQs" },
  posts_widget: { label: "Latest posts", copyFields: ["heading"], live: "Recently published posts" },
  contact: { label: "Contact", copyFields: ["heading", "body"], live: "Phone, address and hours from the business profile" },
  cta: { label: "Call to action", copyFields: ["heading", "body"] },
};

const sec = (type: string, data: Record<string, unknown> = {}): SiteSection => ({ id: randomUUID().slice(0, 8), type, data, manualFields: [], updatedAt: new Date().toISOString() });

type PagePlan = { key: string; path: string; type: PageType; title: string; navLabel: string; sections: { s: SiteSection; purpose?: string }[] };

function planSite(ctx: BusinessContext): PagePlan[] {
  const b = ctx.business;
  const city = b.city ?? ctx.factContext.serviceAreas[0] ?? null;
  const pages: PagePlan[] = [
    {
      key: "home",
      path: "/",
      type: "home",
      title: b.name,
      navLabel: "Home",
      sections: [
        { s: sec("hero", { ctaLabel: b.phone ? "Call now" : "Contact us" }), purpose: `Introduce ${b.name}${city ? ` in ${city}` : ""} and what it does, in one strong heading and two sentences` },
        { s: sec("text"), purpose: "Explain why customers choose this business, using only verified facts" },
        { s: sec("services_list"), purpose: "Heading for the list of services" },
        { s: sec("reviews_widget"), purpose: "Heading for customer reviews" },
        { s: sec("gallery"), purpose: "Heading for a photo gallery of recent work" },
        { s: sec("cta", { ctaLabel: "Get in touch" }), purpose: "Short closing call to action" },
      ],
    },
    { key: "services", path: "/services", type: "services", title: "Services", navLabel: "Services", sections: [{ s: sec("text"), purpose: "Overview of the services offered" }, { s: sec("services_list"), purpose: "Heading for the services list" }] },
  ];
  for (const svc of ctx.services.slice(0, 12)) {
    pages.push({
      key: `service:${svc.id}`,
      path: `/services/${slugify(svc.name, 50)}`,
      type: "service",
      title: svc.name,
      navLabel: svc.name,
      sections: [
        { s: sec("service_detail", { serviceId: svc.id }), purpose: `Describe the ${svc.name} service in detail${svc.description ? ` (known: ${truncate(svc.description, 200)})` : ""}` },
        { s: sec("cta", { ctaLabel: "Request service" }), purpose: `Call to action for ${svc.name}` },
      ],
    });
  }
  if (ctx.factContext.serviceAreas.length) pages.push({ key: "areas", path: "/service-areas", type: "service_area", title: "Service areas", navLabel: "Areas", sections: [{ s: sec("areas"), purpose: `Describe the areas served: ${ctx.factContext.serviceAreas.join(", ")}` }] });
  pages.push(
    { key: "about", path: "/about", type: "about", title: `About ${b.name}`, navLabel: "About", sections: [{ s: sec("text"), purpose: "About the business, its approach and team, using only verified facts" }] },
    { key: "reviews", path: "/reviews", type: "reviews", title: "Reviews", navLabel: "Reviews", sections: [{ s: sec("reviews_widget"), purpose: "Heading for the reviews page" }] },
    { key: "faqs", path: "/faqs", type: "faqs", title: "Frequently asked questions", navLabel: "FAQs", sections: [{ s: sec("faqs"), purpose: "Heading for FAQs" }] },
    { key: "contact", path: "/contact", type: "contact", title: "Contact", navLabel: "Contact", sections: [{ s: sec("contact"), purpose: "Short invitation to get in touch" }] },
    { key: "privacy", path: "/privacy", type: "privacy", title: "Privacy policy", navLabel: "Privacy", sections: [{ s: sec("text", { heading: "Privacy policy", body: `${b.name} collects only the information you choose to send us, such as your name, email or phone number when you contact us, and uses it to respond to you. We do not sell personal information.\n\nThis is a starting template. Review it with your own advisor and edit it to describe your actual practices before publishing.` }) }] },
  );
  return pages;
}

async function uniqueSiteSlug(name: string) {
  const base = slugify(name, 40) || "site";
  for (let i = 0; i < 30; i++) {
    const s = i ? `${base}-${i + 1}` : base;
    const [e] = await db.select({ id: websites.id }).from(websites).where(eq(websites.slug, s)).limit(1);
    if (!e) return s;
  }
  return `${base}-${randomToken(4).toLowerCase()}`;
}

function metaFor(ctx: BusinessContext, p: PagePlan) {
  const city = ctx.business.city ?? ctx.factContext.serviceAreas[0] ?? null;
  const title = p.type === "home" ? `${ctx.business.name}${ctx.business.primaryCategory ? ` | ${ctx.business.primaryCategory}` : ""}${city ? ` in ${city}` : ""}` : `${p.title} | ${ctx.business.name}`;
  return { metaTitle: truncate(title, PLATFORM_LIMITS.meta_title), metaDescription: truncate(ctx.business.description ?? `${p.title} from ${ctx.business.name}${city ? ` in ${city}` : ""}.`, PLATFORM_LIMITS.meta_description) };
}

/** Generates a full site draft. Generated copy goes into draft pages; nothing is public until published. */
export async function generateWebsite(actor: Actor, businessId: string) {
  const b = await requireBusiness(actor, businessId, "website.edit");
  const [existing] = await db.select().from(websites).where(eq(websites.businessId, businessId)).limit(1);
  if (existing) throw invalid("This business already has a website. Regenerate individual sections instead.");
  const ctx = await loadBusinessContext(businessId, ["website_content"]);
  const plan = planSite(ctx);
  const [site] = await db
    .insert(websites)
    .values({ businessId, slug: await uniqueSiteSlug(b.name), name: b.name, theme: { primaryColor: b.brand?.primaryColor ?? "#1d4ed8", accentColor: "#f59e0b", font: "system" }, status: "generating", settings: { robotsAllowIndexing: true, widgets: { reviews: true, gallery: true, posts: true } } })
    .returning();
  try {
    const toGen = plan.map((p) => ({ pageKey: p.key, sections: p.sections.filter((x) => x.purpose).map((x) => ({ key: x.s.id, purpose: x.purpose! })) })).filter((p) => p.sections.length);
    const { data, meta } = await generateWebsiteCopy(ctx, toGen);
    await recordAiUsage(b.orgId, businessId, meta);
    for (const [i, p] of plan.entries()) {
      const gen = data.pages.find((g) => g.pageKey === p.key);
      const sections = p.sections.map(({ s }) => {
        const g = gen?.sections.find((x) => x.key === s.id);
        if (!g || s.data.heading) return s;
        const fields = SECTION_TYPES[s.type].copyFields;
        return { ...s, data: { ...s.data, heading: g.heading, ...(fields.includes("body") ? { body: g.body } : {}) } };
      });
      await db.insert(websitePages).values({ websiteId: site.id, path: p.path, type: p.type, title: p.title, navLabel: p.navLabel, sections, position: i, ...metaFor(ctx, p) });
    }
    await db.update(websites).set({ status: "ready", generationError: null, updatedAt: new Date() }).where(eq(websites.id, site.id));
    await saveRevision(site.id, "Initial generated draft", actor.userId);
  } catch (e) {
    await db.update(websites).set({ status: "failed", generationError: (e as Error).message }).where(eq(websites.id, site.id));
    throw e;
  }
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "website.generated", target: { type: "website", id: site.id } });
  return site;
}

export async function getWebsiteForBusiness(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  const [site] = await db.select().from(websites).where(eq(websites.businessId, businessId)).limit(1);
  if (!site) return null;
  const pages = await db.select().from(websitePages).where(eq(websitePages.websiteId, site.id)).orderBy(asc(websitePages.position));
  const revisions = await db.select({ id: websiteRevisions.id, number: websiteRevisions.number, note: websiteRevisions.note, createdAt: websiteRevisions.createdAt }).from(websiteRevisions).where(eq(websiteRevisions.websiteId, site.id)).orderBy(desc(websiteRevisions.number)).limit(30);
  const deployments = await db.select().from(websiteDeployments).where(eq(websiteDeployments.websiteId, site.id)).orderBy(desc(websiteDeployments.createdAt)).limit(10);
  const domains = await db.select().from(customDomains).where(and(eq(customDomains.websiteId, site.id), sql`${customDomains.status} <> 'removed'`));
  return { site, pages, revisions, deployments, domains };
}

async function requireSitePage(actor: Actor, businessId: string, pageId: string) {
  await requireBusiness(actor, businessId, "website.edit");
  const [row] = await db.select({ page: websitePages, site: websites }).from(websitePages).innerJoin(websites, eq(websites.id, websitePages.websiteId)).where(and(eq(websitePages.id, pageId), eq(websites.businessId, businessId))).limit(1);
  if (!row) throw notFound("Page");
  return row;
}

/** A person's edit. Edited fields are recorded so regeneration will not overwrite them. */
export async function updateSection(actor: Actor, businessId: string, pageId: string, sectionId: string, patch: Record<string, unknown>) {
  const { page } = await requireSitePage(actor, businessId, pageId);
  const sections = page.sections.map((s) => {
    if (s.id !== sectionId) return s;
    const changed = Object.keys(patch).filter((k) => JSON.stringify(s.data[k]) !== JSON.stringify(patch[k]));
    return { ...s, data: { ...s.data, ...patch }, manualFields: Array.from(new Set([...(s.manualFields ?? []), ...changed])), updatedAt: new Date().toISOString() };
  });
  if (!sections.some((s) => s.id === sectionId)) throw notFound("Section");
  const [u] = await db.update(websitePages).set({ sections, updatedAt: new Date() }).where(eq(websitePages.id, pageId)).returning();
  return u;
}

/**
 * Regenerates only the copy fields of one section that a person has not
 * edited. Pass overwriteManual to deliberately replace edited fields.
 */
export async function regenerateSection(actor: Actor, businessId: string, pageId: string, sectionId: string, opts: { instruction?: string | null; overwriteManual?: boolean } = {}) {
  const { page } = await requireSitePage(actor, businessId, pageId);
  const s = page.sections.find((x) => x.id === sectionId);
  if (!s) throw notFound("Section");
  const fields = SECTION_TYPES[s.type]?.copyFields ?? [];
  const editable = opts.overwriteManual ? fields : fields.filter((f) => !(s.manualFields ?? []).includes(f));
  if (!editable.length) throw invalid("Every text field in this section was edited by hand. Choose to overwrite edits if you want new copy.");
  const ctx = await loadBusinessContext(businessId, ["website_content"]);
  const { data, meta } = await regenerateSectionCopy(ctx, { pageTitle: page.title, sectionType: s.type, current: { heading: String(s.data.heading ?? ""), body: String(s.data.body ?? "") }, instruction: opts.instruction ?? null });
  await recordAiUsage(ctx.business.orgId, businessId, meta);
  const v = validateContent(`${data.heading}\n${data.body}`, { kind: "website", facts: ctx.factContext });
  const next: Record<string, unknown> = { ...s.data };
  if (editable.includes("heading")) next.heading = data.heading;
  if (editable.includes("body")) next.body = data.body;
  const sections = page.sections.map((x) => (x.id === sectionId ? { ...x, data: next, manualFields: opts.overwriteManual ? (x.manualFields ?? []).filter((f) => !editable.includes(f)) : x.manualFields, updatedAt: new Date().toISOString() } : x));
  await db.update(websitePages).set({ sections, updatedAt: new Date() }).where(eq(websitePages.id, pageId));
  return { section: sections.find((x) => x.id === sectionId)!, regenerated: editable, preserved: fields.filter((f) => !editable.includes(f)), validation: v, demo: meta.isDemo };
}

export async function addSection(actor: Actor, businessId: string, pageId: string, type: string, afterSectionId?: string) {
  if (!SECTION_TYPES[type]) throw invalid("Unknown section type");
  const { page } = await requireSitePage(actor, businessId, pageId);
  const s = sec(type, { heading: SECTION_TYPES[type].label });
  const idx = afterSectionId ? page.sections.findIndex((x) => x.id === afterSectionId) + 1 : page.sections.length;
  const sections = [...page.sections.slice(0, idx), s, ...page.sections.slice(idx)];
  await db.update(websitePages).set({ sections, updatedAt: new Date() }).where(eq(websitePages.id, pageId));
  return s;
}

export async function moveSection(actor: Actor, businessId: string, pageId: string, sectionId: string, dir: -1 | 1) {
  const { page } = await requireSitePage(actor, businessId, pageId);
  const i = page.sections.findIndex((s) => s.id === sectionId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= page.sections.length) return;
  const sections = [...page.sections];
  [sections[i], sections[j]] = [sections[j], sections[i]];
  await db.update(websitePages).set({ sections, updatedAt: new Date() }).where(eq(websitePages.id, pageId));
}

export async function removeSection(actor: Actor, businessId: string, pageId: string, sectionId: string) {
  const { page } = await requireSitePage(actor, businessId, pageId);
  await db.update(websitePages).set({ sections: page.sections.filter((s) => s.id !== sectionId), updatedAt: new Date() }).where(eq(websitePages.id, pageId));
}

export async function updatePageMeta(actor: Actor, businessId: string, pageId: string, patch: { title?: string; navLabel?: string; metaTitle?: string | null; metaDescription?: string | null; noindex?: boolean; path?: string }) {
  const { page, site } = await requireSitePage(actor, businessId, pageId);
  const set: Partial<WebsitePage> = { updatedAt: new Date() };
  if (patch.title) set.title = patch.title.trim().slice(0, 120);
  if (patch.navLabel) set.navLabel = patch.navLabel.trim().slice(0, 40);
  if (patch.metaTitle !== undefined) set.metaTitle = patch.metaTitle?.slice(0, 120) ?? null;
  if (patch.metaDescription !== undefined) set.metaDescription = patch.metaDescription?.slice(0, 320) ?? null;
  if (patch.noindex !== undefined) set.noindex = patch.noindex;
  if (patch.path && page.type !== "home") {
    const p = `/${patch.path.split("/").map((x) => slugify(x, 60)).filter(Boolean).join("/")}`;
    if (p === "/") throw invalid("Only the home page can use /");
    const [dup] = await db.select({ id: websitePages.id }).from(websitePages).where(and(eq(websitePages.websiteId, site.id), eq(websitePages.path, p))).limit(1);
    if (dup && dup.id !== page.id) throw invalid("Another page already uses that address");
    set.path = p;
  }
  const [u] = await db.update(websitePages).set(set).where(eq(websitePages.id, pageId)).returning();
  return u;
}

export async function addPage(actor: Actor, businessId: string, input: { title: string; path?: string }) {
  await requireBusiness(actor, businessId, "website.edit");
  const [site] = await db.select().from(websites).where(eq(websites.businessId, businessId)).limit(1);
  if (!site) throw notFound("Website");
  const path = `/${slugify(input.path || input.title, 60)}`;
  const [dup] = await db.select({ id: websitePages.id }).from(websitePages).where(and(eq(websitePages.websiteId, site.id), eq(websitePages.path, path))).limit(1);
  if (dup) throw invalid("A page with that address already exists");
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${websitePages.position}), 0)::int` }).from(websitePages).where(eq(websitePages.websiteId, site.id));
  const [p] = await db.insert(websitePages).values({ websiteId: site.id, path, type: "custom", title: input.title.trim(), navLabel: input.title.trim().slice(0, 40), sections: [sec("text", { heading: input.title.trim(), body: "" })], position: n + 1 }).returning();
  return p;
}

export async function deletePage(actor: Actor, businessId: string, pageId: string) {
  const { page } = await requireSitePage(actor, businessId, pageId);
  if (page.type === "home") throw invalid("The home page cannot be deleted");
  await db.delete(websitePages).where(eq(websitePages.id, pageId));
}

export async function updateSiteSettings(actor: Actor, businessId: string, patch: { name?: string; theme?: Partial<Website["theme"]>; robotsAllowIndexing?: boolean; widgets?: Partial<Website["settings"]["widgets"]> }) {
  await requireBusiness(actor, businessId, "website.edit");
  const [site] = await db.select().from(websites).where(eq(websites.businessId, businessId)).limit(1);
  if (!site) throw notFound("Website");
  if (patch.theme?.primaryColor && !/^#[0-9a-f]{6}$/i.test(patch.theme.primaryColor)) throw invalid("Colors must be hex values like #1d4ed8");
  const [u] = await db
    .update(websites)
    .set({
      name: patch.name?.trim() || site.name,
      theme: { ...site.theme, ...(patch.theme ?? {}) },
      settings: { robotsAllowIndexing: patch.robotsAllowIndexing ?? site.settings.robotsAllowIndexing, widgets: { ...site.settings.widgets, ...(patch.widgets ?? {}) } },
      updatedAt: new Date(),
    })
    .where(eq(websites.id, site.id))
    .returning();
  return u;
}

/* ---------------- Revisions and publishing ---------------- */

async function saveRevision(websiteId: string, note: string, userId: string | null) {
  const [site] = await db.select().from(websites).where(eq(websites.id, websiteId)).limit(1);
  const pages = await db.select().from(websitePages).where(eq(websitePages.websiteId, websiteId)).orderBy(asc(websitePages.position));
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${websiteRevisions.number}), 0)::int` }).from(websiteRevisions).where(eq(websiteRevisions.websiteId, websiteId));
  const [rev] = await db
    .insert(websiteRevisions)
    .values({ websiteId, number: n + 1, snapshot: { pages: pages.map(({ id: _i, websiteId: _w, createdAt: _c, updatedAt: _u, ...rest }) => rest), theme: site.theme, settings: site.settings }, note, createdByUserId: userId })
    .returning();
  return rev;
}

export async function saveVersion(actor: Actor, businessId: string, note: string) {
  await requireBusiness(actor, businessId, "website.edit");
  const [site] = await db.select().from(websites).where(eq(websites.businessId, businessId)).limit(1);
  if (!site) throw notFound("Website");
  return saveRevision(site.id, note.trim() || "Saved version", actor.userId);
}

/** Restores a revision into the draft. The live site changes only when the draft is published again. */
export async function restoreRevision(actor: Actor, businessId: string, revisionId: string) {
  await requireBusiness(actor, businessId, "website.edit");
  const [row] = await db.select({ rev: websiteRevisions, site: websites }).from(websiteRevisions).innerJoin(websites, eq(websites.id, websiteRevisions.websiteId)).where(and(eq(websiteRevisions.id, revisionId), eq(websites.businessId, businessId))).limit(1);
  if (!row) throw notFound("Revision");
  await saveRevision(row.site.id, `Before restoring version ${row.rev.number}`, actor.userId);
  await db.transaction(async (tx) => {
    await tx.delete(websitePages).where(eq(websitePages.websiteId, row.site.id));
    for (const p of row.rev.snapshot.pages as Omit<WebsitePage, "id" | "websiteId" | "createdAt" | "updatedAt">[]) await tx.insert(websitePages).values({ ...p, websiteId: row.site.id });
    await tx.update(websites).set({ theme: row.rev.snapshot.theme as Website["theme"], settings: row.rev.snapshot.settings as Website["settings"], updatedAt: new Date() }).where(eq(websites.id, row.site.id));
  });
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "website.revision_restored", target: { type: "website_revision", id: revisionId } });
}

export async function validateSiteForPublish(siteId: string) {
  const [site] = await db.select().from(websites).where(eq(websites.id, siteId)).limit(1);
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, site.businessId)).limit(1);
  const pages = await db.select().from(websitePages).where(eq(websitePages.websiteId, siteId));
  const ctx = await loadBusinessContext(site.businessId);
  const checks: { page: string; issues: ValidationIssue[] }[] = [];
  const assetIds = new Set<string>();
  for (const p of pages) {
    const issues: ValidationIssue[] = [];
    if (!p.metaTitle) issues.push({ code: "meta_title_missing", severity: "warning", message: "No meta title" });
    else if (p.metaTitle.length > PLATFORM_LIMITS.meta_title) issues.push({ code: "meta_title_long", severity: "warning", message: `Meta title is ${p.metaTitle.length} characters; aim for ${PLATFORM_LIMITS.meta_title}` });
    if (!p.metaDescription) issues.push({ code: "meta_description_missing", severity: "warning", message: "No meta description" });
    for (const s of p.sections) {
      const text = [s.data.heading, s.data.body].filter((x) => typeof x === "string" && x).join("\n");
      if (text && p.type !== "privacy") {
        const v = validateContent(text, { kind: "website", facts: ctx.factContext });
        for (const i of v.issues) issues.push({ ...i, message: `${SECTION_TYPES[s.type]?.label ?? s.type}: ${i.message}` });
      }
      if (typeof s.data.imageAssetId === "string") assetIds.add(s.data.imageAssetId);
      if (b.hideAddress && b.addressLine1 && text.includes(b.addressLine1)) issues.push({ code: "private_address", severity: "error", message: "Shows the street address of a service-area business that hides its address" });
    }
    if (p.type === "privacy" && p.sections.some((s) => String(s.data.body ?? "").includes("This is a starting template"))) issues.push({ code: "template_privacy", severity: "warning", message: "The privacy policy is still the starting template" });
    if (issues.length) checks.push({ page: p.path, issues });
  }
  if (assetIds.size) {
    const ok = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(inArray(mediaAssets.id, [...assetIds]), eq(mediaAssets.businessId, b.id), eq(mediaAssets.moderationStatus, "approved"), eq(mediaAssets.useForWebsite, true), isNull(mediaAssets.deletedAt)));
    const missing = [...assetIds].filter((id) => !ok.some((o) => o.id === id));
    if (missing.length) checks.push({ page: "(images)", issues: [{ code: "image_unavailable", severity: "error", message: `${missing.length} image(s) are deleted, unapproved or not allowed on the website` }] });
  }
  return { ok: !checks.some((c) => c.issues.some((i) => i.severity === "error")), checks };
}

export async function publishWebsite(actor: Actor, businessId: string, note?: string) {
  await requireBusiness(actor, businessId, "website.publish");
  const [site] = await db.select().from(websites).where(eq(websites.businessId, businessId)).limit(1);
  if (!site) throw notFound("Website");
  const v = await validateSiteForPublish(site.id);
  const rev = await saveRevision(site.id, note?.trim() || "Published", actor.userId);
  if (!v.ok) {
    await db.insert(websiteDeployments).values({ websiteId: site.id, revisionId: rev.id, status: "failed_validation", checks: v.checks, createdByUserId: actor.userId });
    return { published: false, checks: v.checks };
  }
  const url = siteUrl(site);
  await db.insert(websiteDeployments).values({ websiteId: site.id, revisionId: rev.id, status: "deployed", checks: v.checks, url, createdByUserId: actor.userId });
  await db.update(websites).set({ status: "published", publishedRevisionId: rev.id, publishedAt: new Date(), updatedAt: new Date() }).where(eq(websites.id, site.id));
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "website.published", target: { type: "website", id: site.id }, detail: { revision: rev.number } });
  return { published: true, url, checks: v.checks };
}

export async function unpublishWebsite(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId, "website.publish");
  await db.update(websites).set({ status: "ready", publishedRevisionId: null, updatedAt: new Date() }).where(eq(websites.businessId, businessId));
}

export function siteUrl(site: Pick<Website, "slug">, domain?: string | null) {
  return domain ? `https://${domain}` : `${env().APP_URL.replace(/\/$/, "")}/sites/${site.slug}`;
}

/* ---------------- Public rendering data ---------------- */

export type LiveData = {
  business: { name: string; phone: string | null; email: string | null; address: string | null; hours: Record<string, { open: string; close: string }[]> | null; areas: string[]; appointmentUrl: string | null; googleReviewUrl: string | null; reviewSlug: string };
  services: { name: string; description: string | null; path: string | null }[];
  reviews: { name: string | null; rating: number; text: string | null; date: string; isDemo: boolean }[];
  photos: { id: string; alt: string | null }[];
  faqs: { question: string; answer: string }[];
  posts: { body: string; date: string; imageId: string | null }[];
  schema: Record<string, unknown> | null;
};

export async function liveData(businessId: string, pages: { path: string; type: string; sections: SiteSection[] }[], base: string): Promise<LiveData> {
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const svcs = await db.select().from(businessServices).where(and(eq(businessServices.businessId, businessId), eq(businessServices.status, "active"))).orderBy(asc(businessServices.name));
  const revs = await db.select().from(reviews).where(and(eq(reviews.businessId, businessId), sql`${reviews.rating} >= 4`, sql`coalesce(length(${reviews.text}), 0) > 20`)).orderBy(desc(reviews.publishedAt)).limit(9);
  const photos = await db.select({ id: mediaAssets.id, alt: mediaAssets.altText }).from(mediaAssets).where(and(eq(mediaAssets.businessId, businessId), eq(mediaAssets.kind, "image"), eq(mediaAssets.moderationStatus, "approved"), eq(mediaAssets.useForWebsite, true), isNull(mediaAssets.deletedAt))).orderBy(desc(mediaAssets.createdAt)).limit(12);
  const fq = await db.select().from(faqs).where(and(eq(faqs.businessId, businessId), inArray(faqs.status, ["approved", "published"]))).orderBy(asc(faqs.createdAt)).limit(30);
  const posts = await db.select().from(contentItems).where(and(eq(contentItems.businessId, businessId), eq(contentItems.type, "gbp_post"), eq(contentItems.status, "published"))).orderBy(desc(contentItems.publishedAt)).limit(3);
  const servicePaths = new Map(pages.filter((p) => p.type === "service").map((p) => [String(p.sections.find((s) => s.type === "service_detail")?.data.serviceId ?? ""), p.path]));
  const { doc } = await buildSchemaForBusiness(businessId, base);
  return {
    business: { name: b.name, phone: b.phone, email: b.email, address: b.hideAddress ? null : [b.addressLine1, b.addressLine2, b.city, b.region, b.postalCode].filter(Boolean).join(", ") || null, hours: (b.hours as LiveData["business"]["hours"]) ?? null, areas: b.serviceArea?.places ?? [], appointmentUrl: b.appointmentUrl, googleReviewUrl: b.googleReviewUrl, reviewSlug: b.reviewSlug },
    services: svcs.map((s) => ({ name: s.name, description: s.description, path: servicePaths.get(s.id) ?? null })),
    reviews: revs.map((r) => ({ name: r.reviewerName, rating: r.rating, text: r.text, date: r.publishedAt.toISOString().slice(0, 10), isDemo: r.isDemo })),
    photos,
    faqs: fq.map((f) => ({ question: f.question, answer: f.answer })),
    posts: posts.map((p) => ({ body: p.body, date: (p.publishedAt ?? p.createdAt).toISOString().slice(0, 10), imageId: p.mediaAssetId })),
    schema: doc,
  };
}

type SnapshotPage = Omit<WebsitePage, "id" | "websiteId" | "createdAt" | "updatedAt">;

/** Loads the published revision of a site by slug or custom domain. Drafts are never served publicly. */
export async function getPublishedSite(by: { slug?: string; hostname?: string }) {
  let site: Website | undefined;
  let domain: string | null = null;
  if (by.hostname) {
    const [d] = await db.select().from(customDomains).where(and(eq(customDomains.hostname, by.hostname.toLowerCase()), eq(customDomains.status, "active"))).limit(1);
    if (!d?.websiteId) return null;
    [site] = await db.select().from(websites).where(eq(websites.id, d.websiteId)).limit(1);
    domain = d.hostname;
  } else if (by.slug) {
    [site] = await db.select().from(websites).where(eq(websites.slug, by.slug)).limit(1);
  }
  if (!site?.publishedRevisionId) return null;
  const [rev] = await db.select().from(websiteRevisions).where(eq(websiteRevisions.id, site.publishedRevisionId)).limit(1);
  if (!rev) return null;
  const pages = (rev.snapshot.pages as SnapshotPage[]).slice().sort((a, b) => a.position - b.position);
  return { site: { ...site, theme: rev.snapshot.theme as Website["theme"], settings: rev.snapshot.settings as Website["settings"] }, pages, base: siteUrl(site, domain), domain };
}

export async function getDraftSite(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  const [site] = await db.select().from(websites).where(eq(websites.businessId, businessId)).limit(1);
  if (!site) return null;
  const pages = await db.select().from(websitePages).where(eq(websitePages.websiteId, site.id)).orderBy(asc(websitePages.position));
  return { site, pages: pages as SnapshotPage[], base: siteUrl(site), domain: null };
}

export function sitemapXml(base: string, pages: { path: string; noindex: boolean }[], lastmod: Date) {
  const urls = pages.filter((p) => !p.noindex).map((p) => `<url><loc>${base}${p.path === "/" ? "/" : p.path}</loc><lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
}

export function robotsTxt(base: string, allow: boolean) {
  return allow ? `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n";
}

/* ---------------- Custom domains ---------------- */

const HOST_RE = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

export async function addCustomDomain(actor: Actor, input: { hostname: string; purpose: "website" | "app"; businessId?: string }) {
  assertCan(actor, input.purpose === "app" ? "org.manage" : "website.publish");
  const hostname = input.hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!HOST_RE.test(hostname)) throw invalid("Enter a domain like www.example.com");
  let websiteId: string | null = null;
  if (input.purpose === "website") {
    if (!input.businessId) throw invalid("Choose the website for this domain");
    await requireBusiness(actor, input.businessId, "website.publish");
    const [site] = await db.select().from(websites).where(eq(websites.businessId, input.businessId)).limit(1);
    if (!site) throw invalid("Generate the website first");
    websiteId = site.id;
  }
  const [taken] = await db.select().from(customDomains).where(eq(customDomains.hostname, hostname)).limit(1);
  if (taken && taken.status !== "removed") throw invalid("That domain is already connected");
  if (taken) await db.delete(customDomains).where(eq(customDomains.id, taken.id));
  const [d] = await db.insert(customDomains).values({ orgId: actor.orgId, hostname, purpose: input.purpose, websiteId, verificationToken: `localpilot-verify=${randomToken(16)}` }).returning();
  await logActivity({ orgId: actor.orgId, businessId: input.businessId ?? null, actor: userActor(actor.userId), action: "domain.added", target: { type: "domain", id: d.id }, detail: { hostname } });
  return d;
}

export function domainInstructions(d: { hostname: string; verificationToken: string }) {
  const appHost = new URL(env().APP_URL).hostname;
  return [
    { type: "TXT", name: `_localpilot.${d.hostname}`, value: d.verificationToken, purpose: "Proves you control the domain" },
    { type: "CNAME", name: d.hostname, value: appHost, purpose: "Points the domain at this platform (your host may require an A record for apex domains)" },
  ];
}

/** Checks the DNS TXT record. TLS certificates and routing are handled by the deployment's reverse proxy. */
export async function verifyCustomDomain(actor: Actor, domainId: string) {
  const [d] = await db.select().from(customDomains).where(and(eq(customDomains.id, domainId), eq(customDomains.orgId, actor.orgId))).limit(1);
  if (!d) throw notFound("Domain");
  let records: string[] = [];
  let error: string | null = null;
  try {
    records = (await resolveTxt(`_localpilot.${d.hostname}`)).map((r) => r.join(""));
  } catch (e) {
    error = (e as NodeJS.ErrnoException).code === "ENOTFOUND" || (e as NodeJS.ErrnoException).code === "ENODATA" ? "The TXT record was not found yet. DNS changes can take time to appear." : (e as Error).message;
  }
  const ok = records.includes(d.verificationToken);
  const [u] = await db
    .update(customDomains)
    .set({ status: ok ? "active" : d.status === "active" ? "active" : "pending", lastCheckedAt: new Date(), lastCheck: { records }, lastError: ok ? null : (error ?? "The TXT record does not contain the expected value"), verifiedAt: ok ? (d.verifiedAt ?? new Date()) : d.verifiedAt })
    .where(eq(customDomains.id, d.id))
    .returning();
  if (ok && d.websiteId) await db.update(websites).set({ customDomainId: d.id }).where(eq(websites.id, d.websiteId));
  return u;
}

export async function removeCustomDomain(actor: Actor, domainId: string) {
  const [d] = await db.select().from(customDomains).where(and(eq(customDomains.id, domainId), eq(customDomains.orgId, actor.orgId))).limit(1);
  if (!d) throw notFound("Domain");
  assertCan(actor, d.purpose === "app" ? "org.manage" : "website.publish");
  await db.update(customDomains).set({ status: "removed" }).where(eq(customDomains.id, d.id));
  if (d.websiteId) await db.update(websites).set({ customDomainId: null }).where(and(eq(websites.id, d.websiteId), eq(websites.customDomainId, d.id)));
  await logActivity({ orgId: actor.orgId, actor: userActor(actor.userId), action: "domain.removed", target: { type: "domain", id: d.id } });
}

export async function listDomains(actor: Actor) {
  return db.select().from(customDomains).where(and(eq(customDomains.orgId, actor.orgId), sql`${customDomains.status} <> 'removed'`)).orderBy(desc(customDomains.createdAt));
}

/** Website-updates automation: nothing to copy (live sections read approved FAQs and photos), so it republishes when content changed. */
export async function refreshPublishedSite(businessId: string) {
  const [site] = await db.select().from(websites).where(eq(websites.businessId, businessId)).limit(1);
  if (!site?.publishedRevisionId) return { skipped: "Website is not published" };
  const [f] = await db.select({ n: sql<number>`count(*)::int` }).from(faqs).where(and(eq(faqs.businessId, businessId), eq(faqs.status, "approved")));
  if (f.n) await db.update(faqs).set({ status: "published", publishedAt: new Date() }).where(and(eq(faqs.businessId, businessId), eq(faqs.status, "approved")));
  await logActivity({ orgId: (await db.select({ o: businessLocations.orgId }).from(businessLocations).where(eq(businessLocations.id, businessId)))[0].o, businessId, actor: systemActor, action: "website.live_sections_refreshed", detail: { faqsPublished: f.n } });
  return { faqsPublished: f.n };
}
