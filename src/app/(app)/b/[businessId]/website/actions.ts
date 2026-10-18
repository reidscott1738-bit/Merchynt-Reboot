"use server";

import { bool, formAction, optStr, str } from "@/server/actions";
import { invalid } from "@/server/errors";
import {
  addCustomDomain,
  addPage,
  addSection,
  deletePage,
  generateWebsite,
  moveSection,
  publishWebsite,
  regenerateSection,
  removeCustomDomain,
  removeSection,
  restoreRevision,
  saveVersion,
  unpublishWebsite,
  updatePageMeta,
  updateSection,
  updateSiteSettings,
  verifyCustomDomain,
  SECTION_TYPES,
} from "@/server/services/websites";

const bid = (f: FormData) => str(f, "businessId");

export async function websiteAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = bid(form);
    const pageId = str(form, "pageId");
    const sectionId = str(form, "sectionId");
    switch (str(form, "op")) {
      case "generate":
        await generateWebsite(actor, businessId);
        return "Website drafted. Review each page, then publish.";
      case "section": {
        const patch: Record<string, unknown> = {};
        for (const k of ["heading", "body", "ctaLabel", "imageAssetId"]) if (form.has(k)) patch[k] = str(form, k) || null;
        await updateSection(actor, businessId, pageId, sectionId, patch);
        return "Section saved. Edited fields are kept when you regenerate.";
      }
      case "regenerate": {
        const r = await regenerateSection(actor, businessId, pageId, sectionId, { instruction: optStr(form, "instruction"), overwriteManual: bool(form, "overwriteManual") });
        const issues = r.validation.issues.filter((i) => i.severity === "error").map((i) => i.message);
        return `Regenerated ${r.regenerated.join(" and ")}${r.preserved.length ? `; kept your edits to ${r.preserved.join(" and ")}` : ""}${r.demo ? " (demo copy)" : ""}${issues.length ? `. Check: ${issues.join("; ")}` : ""}`;
      }
      case "add-section":
        if (!SECTION_TYPES[str(form, "type")]) throw invalid("Unknown section");
        await addSection(actor, businessId, pageId, str(form, "type"));
        return "Section added";
      case "up":
      case "down":
        await moveSection(actor, businessId, pageId, sectionId, str(form, "op") === "up" ? -1 : 1);
        return "Moved";
      case "remove-section":
        await removeSection(actor, businessId, pageId, sectionId);
        return "Section removed";
      case "page-meta":
        await updatePageMeta(actor, businessId, pageId, { title: optStr(form, "title") ?? undefined, navLabel: optStr(form, "navLabel") ?? undefined, metaTitle: optStr(form, "metaTitle"), metaDescription: optStr(form, "metaDescription"), noindex: bool(form, "noindex"), path: optStr(form, "path") ?? undefined });
        return "Page settings saved";
      case "add-page": {
        const p = await addPage(actor, businessId, { title: str(form, "title"), path: optStr(form, "path") ?? undefined });
        return { redirect: `/b/${businessId}/website?page=${p.id}`, ok: "Page added" };
      }
      case "delete-page":
        await deletePage(actor, businessId, pageId);
        return { redirect: `/b/${businessId}/website`, ok: "Page deleted" };
      case "settings":
        await updateSiteSettings(actor, businessId, { name: optStr(form, "name") ?? undefined, theme: { primaryColor: str(form, "primaryColor"), accentColor: str(form, "accentColor") }, robotsAllowIndexing: bool(form, "robotsAllowIndexing") });
        return "Site settings saved";
      case "save-version":
        await saveVersion(actor, businessId, str(form, "note"));
        return "Version saved";
      case "restore":
        await restoreRevision(actor, businessId, str(form, "revisionId"));
        return "Version restored into the draft. Publish to make it live.";
      case "publish": {
        const r = await publishWebsite(actor, businessId, optStr(form, "note") ?? undefined);
        if (!r.published) {
          const errs = r.checks.flatMap((c) => c.issues.filter((i) => i.severity === "error").map((i) => `${c.page}: ${i.message}`));
          throw invalid(`Not published. Fix: ${errs.join("; ")}`);
        }
        return `Published at ${r.url}`;
      }
      case "unpublish":
        await unpublishWebsite(actor, businessId);
        return "Website taken offline";
      case "add-domain":
        await addCustomDomain(actor, { hostname: str(form, "hostname"), purpose: "website", businessId });
        return "Domain added. Create the DNS records shown, then verify.";
      case "verify-domain": {
        const d = await verifyCustomDomain(actor, str(form, "domainId"));
        return d.status === "active" ? "Domain verified" : `Not verified yet: ${d.lastError}`;
      }
      case "remove-domain":
        await removeCustomDomain(actor, str(form, "domainId"));
        return "Domain removed";
    }
  });
}
