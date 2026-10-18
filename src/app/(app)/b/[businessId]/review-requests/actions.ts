"use server";

import { bool, filesFrom, formAction, num, optStr, str } from "@/server/actions";
import { requireBusiness } from "@/server/authz";
import { localToDate } from "@/server/forms";
import { invalid } from "@/server/errors";
import { addContact, archiveReviewLink, createCampaign, createReviewLink, DEFAULT_CAMPAIGN, getCampaign, importContacts, pauseCampaign, resumeCampaign, sendDueForCampaign, startCampaign, updateCampaign, validateCampaign } from "@/server/services/campaigns";

const bid = (f: FormData) => str(f, "businessId");

export async function linkAction(form: FormData) {
  await formAction(form, async (actor) => {
    if (str(form, "op") === "archive") {
      await archiveReviewLink(actor, bid(form), str(form, "id"));
      return "Link archived";
    }
    await createReviewLink(actor, bid(form), { label: str(form, "label"), salesperson: optStr(form, "salesperson"), service: optStr(form, "service"), photoBoostEnabled: bool(form, "photoBoostEnabled") });
    return "Review link created";
  });
}

function campaignInput(form: FormData) {
  return {
    name: str(form, "name"),
    subject: str(form, "subject") || DEFAULT_CAMPAIGN.subject,
    messageTemplate: str(form, "messageTemplate") || DEFAULT_CAMPAIGN.messageTemplate,
    followUp: { enabled: bool(form, "followUpEnabled"), delayDays: num(form, "delayDays") ?? 4, maxFollowUps: num(form, "maxFollowUps") ?? 1, messageTemplate: str(form, "followUpTemplate") || undefined },
    dailyLimit: num(form, "dailyLimit") ?? 50,
    sendWindow: { startHour: num(form, "startHour") ?? 9, endHour: num(form, "endHour") ?? 18 },
    linkId: optStr(form, "linkId"),
  };
}

export async function createCampaignAction(form: FormData) {
  await formAction(form, async (actor) => {
    const c = await createCampaign(actor, bid(form), { ...DEFAULT_CAMPAIGN, ...campaignInput(form) });
    return { redirect: `/b/${bid(form)}/review-requests/${c.id}`, ok: "Campaign created. Add contacts next." };
  });
}

export async function campaignAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = bid(form);
    const id = str(form, "campaignId");
    switch (str(form, "op")) {
      case "update":
        await updateCampaign(actor, businessId, id, campaignInput(form));
        return "Campaign saved";
      case "import": {
        const files = await filesFrom(form, "csv");
        const text = files[0] ? files[0].data.toString("utf8") : str(form, "csvText");
        if (!text) throw invalid("Choose a CSV file or paste rows");
        const r = await importContacts(actor, businessId, id, text);
        return `Imported ${r.inserted} contact(s). ${Object.entries(r).filter(([k]) => k !== "inserted").map(([k, v]) => `${k}: ${v}`).join(", ")}`;
      }
      case "add":
        await addContact(actor, businessId, id, { name: optStr(form, "contactName") ?? undefined, email: str(form, "contactEmail") });
        return "Contact added";
      case "validate": {
        const v = await validateCampaign(actor, businessId, id);
        return v.ok ? "Ready to send" : `Not ready: ${v.problems.join(" ")}`;
      }
      case "start": {
        const at = str(form, "startAt");
        const b = await requireBusiness(actor, businessId, "campaigns.manage");
        await startCampaign(actor, businessId, id, at ? localToDate(at, b.timezone) : null);
        return "Campaign started. Emails go out within the send window and daily limit.";
      }
      case "pause":
        await pauseCampaign(actor, businessId, id);
        return "Campaign paused";
      case "resume":
        await resumeCampaign(actor, businessId, id);
        return "Campaign resumed";
      case "send": {
        await requireBusiness(actor, businessId, "campaigns.manage");
        await getCampaign(actor, businessId, id);
        const r = await sendDueForCampaign(id);
        return `Send run finished: ${JSON.stringify(r)}`;
      }
    }
  });
}
