"use server";

import { formAction, optStr, str } from "@/server/actions";
import { requireBusiness } from "@/server/authz";
import {
  createRemovalRequest,
  deleteTemplate,
  ignoreReview,
  processReviews,
  requeueReview,
  saveAiDraft,
  saveTemplate,
  submitManualReply,
  syncReviews,
  updateRemovalRequest,
} from "@/server/services/reviews";

const bid = (f: FormData) => str(f, "businessId");

export async function reviewAction(form: FormData) {
  await formAction(form, async (actor) => {
    const op = str(form, "op");
    const businessId = bid(form);
    const reviewId = str(form, "reviewId");
    switch (op) {
      case "sync": {
        await requireBusiness(actor, businessId, "reviews.manage");
        const r = await syncReviews(businessId);
        return `Synced from Google: ${r.created} new of ${r.fetched} fetched`;
      }
      case "process": {
        await requireBusiness(actor, businessId, "reviews.manage");
        const r = await processReviews(businessId, { mode: "new" });
        return `Processed ${r.processed} review(s): ${Object.entries(r.tally).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing due"}`;
      }
      case "draft":
        await saveAiDraft(actor, businessId, reviewId);
        return "Draft created. Edit it if needed, then publish.";
      case "submit":
        await submitManualReply(actor, businessId, reviewId, str(form, "content"));
        return "Reply queued for publishing";
      case "ignore":
        await ignoreReview(actor, businessId, reviewId);
        return "Review marked as not needing a reply";
      case "requeue":
        await requeueReview(actor, businessId, reviewId);
        return "Review will be processed by the next automation run";
      case "report":
        await createRemovalRequest(actor, businessId, reviewId, { reason: str(form, "reason"), evidence: optStr(form, "evidence") ?? undefined });
        return "Removal request recorded. Submit it through Google, then update its status.";
    }
  });
}

export async function templateAction(form: FormData) {
  await formAction(form, async (actor) => {
    if (str(form, "op") === "delete") await deleteTemplate(actor, bid(form), str(form, "id"));
    else await saveTemplate(actor, bid(form), { id: optStr(form, "id") ?? undefined, name: str(form, "name"), body: str(form, "body") });
  }, "Template saved");
}

export async function removalAction(form: FormData) {
  await formAction(form, (actor) => updateRemovalRequest(actor, bid(form), str(form, "id"), { status: str(form, "status") as "submitted" | "removed" | "kept" | "unknown", notes: optStr(form, "notes") ?? undefined }), "Removal request updated");
}
