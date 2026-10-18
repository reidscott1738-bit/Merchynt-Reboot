"use server";

import { all, bool, formAction, optStr, str } from "@/server/actions";
import { businessFromForm } from "@/server/forms";
import { requireBusiness } from "@/server/authz";
import {
  addService,
  applyRecommendedSettings,
  archiveBusiness,
  bulkApplyServiceProposals,
  confirmAttribute,
  decideService,
  deleteKnowledge,
  restoreTrainingVersion,
  saveTraining,
  setKnowledgeVerification,
  setOnboardingStep,
  updateBusiness,
  updateService,
  upsertKnowledge,
  type OnboardingStepKey,
} from "@/server/services/business";
import { applyRecommendation, dismissRecommendation, generateRecommendations, refreshScore } from "@/server/services/optimization";
import { importGoogleProfile } from "@/server/services/integrations";
import { savePolicies } from "@/server/services/reviews";
import type { TrainingCategory } from "@/server/db/schema";

const bid = (f: FormData) => str(f, "businessId");

export async function updateBusinessAction(form: FormData) {
  await formAction(form, async (actor) => {
    const origin = str(form, "origin") === "onboarding" ? "onboarding" : "user";
    await updateBusiness(actor, bid(form), businessFromForm(form), origin);
    const step = optStr(form, "completeStep");
    if (step) await setOnboardingStep(actor, bid(form), step as OnboardingStepKey, "done");
  }, "Business details saved");
}

export async function archiveBusinessAction(form: FormData) {
  await formAction(form, async (actor) => {
    await archiveBusiness(actor, bid(form));
    return { redirect: "/dashboard", ok: "Business archived" };
  });
}

export async function onboardingStepAction(form: FormData) {
  await formAction(form, (actor) => setOnboardingStep(actor, bid(form), str(form, "step") as OnboardingStepKey, str(form, "status") as "done" | "skipped" | "todo"), "Step updated");
}

export async function applyTrustAction(form: FormData) {
  await formAction(form, async (actor) => {
    await applyRecommendedSettings(actor, bid(form), all(form, "accept"));
  }, "Recommended settings applied. You can change any of them under Automations.");
}

export async function knowledgeAction(form: FormData) {
  await formAction(form, async (actor) => {
    const op = str(form, "op");
    if (op === "add") await upsertKnowledge(actor, bid(form), { category: str(form, "category"), key: str(form, "key"), value: str(form, "value"), isPublic: bool(form, "isPublic") }, "user");
    else if (op === "verify") await setKnowledgeVerification(actor, bid(form), str(form, "id"), "verified", optStr(form, "value") ?? undefined);
    else if (op === "reject") await setKnowledgeVerification(actor, bid(form), str(form, "id"), "rejected");
    else if (op === "delete") await deleteKnowledge(actor, bid(form), str(form, "id"));
  });
}

export async function serviceAction(form: FormData) {
  await formAction(form, async (actor) => {
    const op = str(form, "op");
    if (op === "add") await addService(actor, bid(form), { name: str(form, "name"), category: optStr(form, "category"), description: optStr(form, "description") });
    else if (op === "update") await updateService(actor, bid(form), str(form, "id"), { name: str(form, "name"), description: optStr(form, "description") });
    else if (op === "bulk") return `${await bulkApplyServiceProposals(actor, bid(form))} proposals applied`;
    else await decideService(actor, bid(form), str(form, "id"), op as "approve" | "reject" | "remove");
  });
}

export async function attributeAction(form: FormData) {
  await formAction(form, (actor) => confirmAttribute(actor, bid(form), str(form, "id"), str(form, "op") === "confirm" ? "confirm" : "reject", str(form, "value") !== "false"));
}

export async function trainingAction(form: FormData) {
  await formAction(form, async (actor) => {
    if (str(form, "op") === "restore") {
      await restoreTrainingVersion(actor, bid(form), str(form, "versionId"));
      return "Version restored";
    }
    const { warnings } = await saveTraining(actor, bid(form), str(form, "category") as TrainingCategory, str(form, "content"));
    return warnings.length ? `Saved. Check: ${warnings.join(" ")}` : "Instructions saved";
  });
}

export async function recommendationsAction(form: FormData) {
  await formAction(form, async (actor) => {
    const op = str(form, "op");
    const businessId = bid(form);
    if (op === "analyze") {
      await requireBusiness(actor, businessId, "business.edit");
      await refreshScore(businessId);
      const recs = await generateRecommendations(businessId, { generateCopy: bool(form, "generateCopy") });
      return `Analysis complete: ${recs.length} recommendation(s)`;
    }
    if (op === "apply") {
      const edited = form.has("edited") ? str(form, "edited") : undefined;
      await applyRecommendation(actor, businessId, str(form, "id"), edited);
      return "Recommendation applied";
    }
    if (op === "dismiss") {
      await dismissRecommendation(actor, businessId, str(form, "id"));
      return "Dismissed";
    }
  });
}

export async function importGoogleAction(form: FormData) {
  await formAction(form, async (actor) => {
    await requireBusiness(actor, bid(form), "integrations.manage");
    await importGoogleProfile(bid(form));
  }, "Imported the latest profile data from Google. Imported facts wait for your confirmation.");
}

export async function savePoliciesAction(form: FormData) {
  await formAction(form, async (actor) => {
    const policies = [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      mode: str(form, `mode_${rating}`),
      templateId: optStr(form, `template_${rating}`),
      templateRequiresApproval: bool(form, `tplApproval_${rating}`),
      escalate: bool(form, `escalate_${rating}`),
    }));
    await savePolicies(actor, bid(form), policies);
    const step = optStr(form, "completeStep");
    if (step) await setOnboardingStep(actor, bid(form), step as OnboardingStepKey, "done");
  }, "Review reply rules saved");
}
