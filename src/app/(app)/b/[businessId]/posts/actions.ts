"use server";

import { all, bool, formAction, optStr, str } from "@/server/actions";
import { requireBusiness } from "@/server/authz";
import { cancelPost, createManualPost, generatePostBatch, publishNow, regeneratePost, updatePost } from "@/server/services/posts";
import { retryPublications } from "@/server/services/publishing";
import { getPost } from "@/server/services/posts";
import { localToDate } from "@/server/forms";

const bid = (f: FormData) => str(f, "businessId");

export async function createPostAction(form: FormData) {
  await formAction(form, async (actor) => {
    const b = await requireBusiness(actor, bid(form), "content.create");
    const when = str(form, "scheduledFor");
    await createManualPost(actor, bid(form), {
      body: str(form, "body"),
      mediaAssetId: optStr(form, "mediaAssetId"),
      ctaType: str(form, "ctaType") || "LEARN_MORE",
      ctaUrl: optStr(form, "ctaUrl"),
      destinations: all(form, "destinations"),
      scheduledFor: when ? localToDate(when, b.timezone) : null,
      requestApproval: bool(form, "requestApproval"),
    });
  }, "Post created");
}

export async function postAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = bid(form);
    const id = str(form, "postId");
    switch (str(form, "op")) {
      case "generate": {
        await requireBusiness(actor, businessId, "content.create");
        const r = await generatePostBatch(businessId, { actorUserId: actor.userId });
        return r.created ? `Drafted ${r.created} post(s)` : (r.reason ?? "No posts drafted");
      }
      case "save": {
        const b = await requireBusiness(actor, businessId, "content.create");
        const when = str(form, "scheduledFor");
        await updatePost(actor, businessId, id, { body: str(form, "body"), scheduledFor: when ? localToDate(when, b.timezone) : null, mediaAssetId: optStr(form, "mediaAssetId"), destinations: all(form, "destinations") });
        return "Post updated";
      }
      case "regenerate":
        await regeneratePost(actor, businessId, id);
        return "New copy drafted";
      case "publish":
        await publishNow(actor, businessId, id);
        return "Publishing now";
      case "cancel":
        await cancelPost(actor, businessId, id);
        return "Post cancelled";
      case "retry":
        await requireBusiness(actor, businessId, "content.approve");
        await getPost(actor, businessId, id);
        await retryPublications(businessId, "content_item", id);
        return "Retrying failed destinations";
    }
  });
}
