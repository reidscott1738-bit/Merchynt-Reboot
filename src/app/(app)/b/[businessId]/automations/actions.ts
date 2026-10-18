"use server";

import { all, bool, formAction, list, num, str } from "@/server/actions";
import { invalid } from "@/server/errors";
import { runAutomationNow, updateAutomation } from "@/server/services/automations";
import { AUTOMATION_TYPES, type AutomationType } from "@/server/db/schema";

function configFromForm(type: AutomationType, f: FormData): Record<string, unknown> {
  const n = (k: string) => num(f, k) ?? undefined;
  switch (type) {
    case "posting":
      return {
        postsPerWeek: n("postsPerWeek"),
        batchSize: n("batchSize"),
        imageSource: str(f, "imageSource"),
        imageReuseDays: n("imageReuseDays"),
        imageMode: str(f, "imageMode"),
        cta: str(f, "cta"),
        customCtaText: str(f, "customCtaText") || undefined,
        approvalMode: str(f, "approvalMode"),
        destinations: all(f, "destinations"),
        holidayReferences: bool(f, "holidayReferences"),
      };
    case "review_replies":
    case "historical_reviews":
      return { historicalLookbackDays: n("historicalLookbackDays"), historicalPerRun: n("historicalPerRun"), signOff: str(f, "signOff") || undefined };
    case "faq_generation":
      return { perRun: n("perRun"), approvalMode: str(f, "approvalMode") };
    case "video_generation":
      return { format: str(f, "format"), approvalMode: str(f, "approvalMode"), destinations: all(f, "destinations") };
    case "reporting":
      return { recipients: list(f, "recipients"), comparisonPeriod: str(f, "comparisonPeriod"), includeSections: all(f, "includeSections") };
    case "ai_visibility_audit":
      return { providers: all(f, "providers"), queriesPerKeyword: n("queriesPerKeyword") };
    case "ranking_audit":
      return { keywordIds: all(f, "keywordIds") };
    case "review_requests":
      return { campaignIds: all(f, "campaignIds") };
    case "website_updates":
      return { autoPublishFaqs: bool(f, "autoPublishFaqs") };
    default:
      return {};
  }
}

export async function saveAutomationAction(form: FormData) {
  await formAction(form, async (actor) => {
    const type = str(form, "type") as AutomationType;
    if (!AUTOMATION_TYPES.includes(type)) throw invalid("Unknown automation");
    const frequency = str(form, "frequency") as "hourly" | "daily" | "weekly" | "monthly";
    const schedule = {
      frequency,
      time: str(form, "time") || "09:00",
      daysOfWeek: frequency === "weekly" ? all(form, "daysOfWeek").map(Number) : undefined,
      dayOfMonth: frequency === "monthly" ? (num(form, "dayOfMonth") ?? 1) : undefined,
      interval: num(form, "interval") ?? undefined,
    };
    await updateAutomation(actor, str(form, "businessId"), type, {
      enabled: bool(form, "enabled"),
      schedule,
      config: configFromForm(type, form),
      notificationRecipients: list(form, "notificationRecipients"),
      showTasksInDashboard: bool(form, "showTasksInDashboard"),
      maxRetries: num(form, "maxRetries") ?? undefined,
    });
  }, "Automation saved");
}

export async function runAutomationAction(form: FormData) {
  await formAction(form, (actor) => runAutomationNow(actor, str(form, "businessId"), str(form, "type") as AutomationType), "Run queued. Results appear in the history below once the worker finishes.");
}
