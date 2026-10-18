"use server";

import { bool, filesFrom, formAction, num, optStr, str } from "@/server/actions";
import { requireBusiness } from "@/server/authz";
import { enqueue } from "@/server/jobs/queue";
import { env } from "@/server/env";
import { createUploadLink, deleteMedia, getMedia, importFromCompanyCam, importFromGoogle, ingestMedia, moderateMedia, revokeUploadLink, updateMedia } from "@/server/services/media";
import { listIntegrations } from "@/server/services/integrations";
import { AppError } from "@/server/errors";

const bid = (f: FormData) => str(f, "businessId");

export async function uploadMediaAction(form: FormData) {
  await formAction(form, async (actor) => {
    const b = await requireBusiness(actor, bid(form), "media.manage");
    const files = await filesFrom(form);
    if (!files.length) throw new AppError("Choose at least one file", "invalid");
    let added = 0;
    let dupes = 0;
    const errors: string[] = [];
    for (const f of files) {
      try {
        const r = await ingestMedia({ businessId: b.id, data: f.data, filename: f.filename, source: "upload", uploadedByUserId: actor.userId, describe: true });
        if (r.duplicate) dupes++;
        else added++;
      } catch (e) {
        errors.push(`${f.filename}: ${(e as Error).message}`);
      }
    }
    return [`${added} uploaded`, dupes ? `${dupes} already in the library` : "", errors.length ? `Failed: ${errors.join("; ")}` : ""].filter(Boolean).join(". ");
  });
}

export async function mediaAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = bid(form);
    const id = str(form, "assetId");
    switch (str(form, "op")) {
      case "save": {
        const lat = num(form, "assocLat");
        const lng = num(form, "assocLng");
        await updateMedia(actor, businessId, id, {
          altText: optStr(form, "altText"),
          description: optStr(form, "description"),
          seoFilename: optStr(form, "seoFilename"),
          assocLabel: optStr(form, "assocLabel"),
          assocLat: lat,
          assocLng: lng,
          useForPosts: bool(form, "useForPosts"),
          useForWebsite: bool(form, "useForWebsite"),
          useForVideos: bool(form, "useForVideos"),
          useForGoogleMedia: bool(form, "useForGoogleMedia"),
        });
        return "Photo details saved";
      }
      case "approve":
        await moderateMedia(actor, businessId, id, "approved");
        return "Approved";
      case "reject":
        await moderateMedia(actor, businessId, id, "rejected", optStr(form, "notes") ?? undefined);
        return "Rejected";
      case "delete":
        await deleteMedia(actor, businessId, id);
        return "Removed from the library";
      case "google": {
        const b = await requireBusiness(actor, businessId, "media.manage");
        const { asset } = await getMedia(actor, businessId, id);
        if (asset.isAiGenerated) throw new AppError("AI-generated images are not uploaded to Google as photos of the business", "invalid");
        await enqueue("media.pushGoogle", { assetId: asset.id }, { idempotencyKey: `media-google:${asset.id}`, businessId, orgId: b.orgId });
        return "Queued for upload to Google";
      }
    }
  });
}

export async function importMediaAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = bid(form);
    await requireBusiness(actor, businessId, "media.manage");
    if (str(form, "source") === "google") {
      const r = await importFromGoogle(businessId);
      return `Imported ${r.imported} photo(s) from Google`;
    }
    const cc = (await listIntegrations(actor)).find((i) => i.provider === "companycam" && i.status === "active");
    if (!cc) throw new AppError("Connect CompanyCam under Integrations first", "not_configured");
    const r = await importFromCompanyCam(businessId, cc.id, num(form, "days") ?? 30);
    return `Imported ${r.imported} of ${r.seen} CompanyCam photo(s)`;
  });
}

export async function uploadLinkAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = bid(form);
    if (str(form, "op") === "revoke") {
      await revokeUploadLink(actor, businessId, str(form, "id"));
      return "Link revoked";
    }
    const { token } = await createUploadLink(actor, businessId, { label: str(form, "label") || "Upload link", requireApproval: bool(form, "requireApproval"), expiresInDays: num(form, "expiresInDays") ?? 30 });
    const url = `${env().APP_URL.replace(/\/$/, "")}/upload/${token}`;
    return { redirect: `/b/${businessId}/media?tab=links&newLink=${encodeURIComponent(url)}`, ok: "Upload link created. Copy it now; it is not shown again." };
  });
}
