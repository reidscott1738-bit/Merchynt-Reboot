import type { ReviewMode } from "@/server/db/schema";

export type RatingPolicy = { rating: number; mode: ReviewMode; templateId?: string | null; templateRequiresApproval?: boolean; escalate?: boolean };

export type ReviewDecision =
  | { action: "skip"; reason: string }
  | { action: "ignore"; reason: string }
  | { action: "generate"; publish: "auto" | "approval"; escalate: boolean }
  | { action: "template"; templateId: string; publish: "auto" | "approval"; escalate: boolean };

/** Example defaults offered by the recommended-settings flow; not claimed to be Paige's. */
export const RECOMMENDED_REVIEW_POLICIES: RatingPolicy[] = [
  { rating: 5, mode: "auto" },
  { rating: 4, mode: "approval" },
  { rating: 3, mode: "approval" },
  { rating: 2, mode: "approval", escalate: true },
  { rating: 1, mode: "approval", escalate: true },
];

/**
 * Decides what to do with a review given its per-rating policy. Pure function;
 * the caller is responsible for persistence and side effects.
 */
export function decideReviewAction(
  review: { rating: number; ownerReply: string | null; replyStatus: string },
  policies: RatingPolicy[],
): ReviewDecision {
  if (review.ownerReply) return { action: "skip", reason: "Review already has an owner reply" };
  if (!["unanswered", "failed"].includes(review.replyStatus)) return { action: "skip", reason: `Reply already ${review.replyStatus}` };
  if (review.rating < 1 || review.rating > 5) return { action: "skip", reason: "Invalid rating" };
  const policy = policies.find((p) => p.rating === review.rating);
  if (!policy) return { action: "skip", reason: `No policy configured for ${review.rating}-star reviews` };
  const escalate = Boolean(policy.escalate);
  switch (policy.mode) {
    case "ignore":
      return { action: "ignore", reason: `${review.rating}-star reviews are set to Ignore` };
    case "auto":
      // Escalated ratings never auto-publish, even if misconfigured.
      return { action: "generate", publish: escalate ? "approval" : "auto", escalate };
    case "approval":
      return { action: "generate", publish: "approval", escalate };
    case "template":
      if (!policy.templateId) return { action: "skip", reason: `No template selected for ${review.rating}-star reviews` };
      return { action: "template", templateId: policy.templateId, publish: policy.templateRequiresApproval || escalate ? "approval" : "auto", escalate };
  }
}

export function renderTemplate(body: string, vars: { reviewer_first_name?: string | null; business_name: string }): string {
  const first = vars.reviewer_first_name?.trim() || "there";
  return body.replaceAll("{reviewer_first_name}", first).replaceAll("{business_name}", vars.business_name).trim();
}
