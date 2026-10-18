"use server";

import { all, formAction, num, str } from "@/server/actions";
import { startAiVisibilityAudit } from "@/server/services/ai-visibility";

export async function aiVisibilityAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = str(form, "businessId");
    const audit = await startAiVisibilityAudit(
      businessId,
      { providers: all(form, "providers"), queriesPerKeyword: Math.min(3, Math.max(1, num(form, "queriesPerKeyword") ?? 1)), keywordIds: all(form, "keywordIds"), trigger: "manual" },
      actor,
    );
    return { redirect: `/b/${businessId}/ai-visibility/${audit.id}`, ok: "Audit started" };
  });
}
