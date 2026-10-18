"use server";

import { formAction, num, optStr, str } from "@/server/actions";
import { requireBusiness } from "@/server/authz";
import { invalid } from "@/server/errors";
import { deleteFaq, generateFaqsForBusiness, generateSchemaDocument, markSeoRecommendation, saveFaq, startSeoAudit } from "@/server/services/seo";

export async function seoAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = str(form, "businessId");
    switch (str(form, "op")) {
      case "audit":
        await startSeoAudit(actor, businessId, optStr(form, "url") ?? undefined);
        return "Audit started. Results appear here when it finishes.";
      case "applied":
      case "dismissed":
        await markSeoRecommendation(actor, businessId, str(form, "recId"), str(form, "op") as "applied" | "dismissed");
        return str(form, "op") === "applied" ? "Marked as done. Run the audit again to confirm." : "Dismissed";
      case "schema":
        await generateSchemaDocument(actor, businessId);
        return "Structured data regenerated";
      case "faq-generate": {
        await requireBusiness(actor, businessId, "website.edit");
        const count = Math.min(10, Math.max(1, num(form, "count") ?? 5));
        const r = await generateFaqsForBusiness(businessId, count, "all");
        return `${r.created} FAQ draft${r.created === 1 ? "" : "s"} added for approval${r.demo ? " (demo AI, review carefully)" : ""}`;
      }
      case "faq-save": {
        const question = str(form, "question").trim();
        const answer = str(form, "answer").trim();
        if (!question || !answer) throw invalid("Enter a question and an answer");
        await saveFaq(actor, businessId, { id: optStr(form, "id") ?? undefined, question, answer, status: str(form, "status") === "draft" ? "draft" : "approved" });
        return "FAQ saved";
      }
      case "faq-delete":
        await deleteFaq(actor, businessId, str(form, "id"));
        return "FAQ deleted";
      default:
        throw invalid("Unknown action");
    }
  });
}
