import { describe, expect, it } from "vitest";
import { decideReviewAction, renderTemplate, RECOMMENDED_REVIEW_POLICIES, type RatingPolicy } from "@/lib/review-policy";
import { finalApprovalDecision, nextTaskStatus, postRequiresApproval } from "@/lib/approval-policy";
import { can, permissionsFor } from "@/lib/permissions";

const unanswered = (rating: number) => ({ rating, ownerReply: null, replyStatus: "unanswered" });

describe("review policy", () => {
  it("follows the per-star mode", () => {
    expect(decideReviewAction(unanswered(5), RECOMMENDED_REVIEW_POLICIES)).toEqual({ action: "generate", publish: "auto", escalate: false });
    expect(decideReviewAction(unanswered(4), RECOMMENDED_REVIEW_POLICIES)).toEqual({ action: "generate", publish: "approval", escalate: false });
    expect(decideReviewAction(unanswered(1), RECOMMENDED_REVIEW_POLICIES)).toEqual({ action: "generate", publish: "approval", escalate: true });
  });
  it("never auto-publishes an escalated rating, even when misconfigured", () => {
    const p: RatingPolicy[] = [{ rating: 1, mode: "auto", escalate: true }];
    expect(decideReviewAction(unanswered(1), p)).toMatchObject({ action: "generate", publish: "approval" });
  });
  it("skips reviews that already have a reply or are in flight", () => {
    expect(decideReviewAction({ rating: 5, ownerReply: "Thanks", replyStatus: "unanswered" }, RECOMMENDED_REVIEW_POLICIES).action).toBe("skip");
    expect(decideReviewAction({ rating: 5, ownerReply: null, replyStatus: "pending_approval" }, RECOMMENDED_REVIEW_POLICIES).action).toBe("skip");
    expect(decideReviewAction({ rating: 5, ownerReply: null, replyStatus: "failed" }, RECOMMENDED_REVIEW_POLICIES).action).toBe("generate");
  });
  it("handles ignore, missing policy and templates", () => {
    expect(decideReviewAction(unanswered(3), [{ rating: 3, mode: "ignore" }]).action).toBe("ignore");
    expect(decideReviewAction(unanswered(3), []).action).toBe("skip");
    expect(decideReviewAction(unanswered(5), [{ rating: 5, mode: "template" }]).action).toBe("skip");
    expect(decideReviewAction(unanswered(5), [{ rating: 5, mode: "template", templateId: "t1", templateRequiresApproval: true }])).toEqual({ action: "template", templateId: "t1", publish: "approval", escalate: false });
  });
  it("renders templates with a fallback name", () => {
    expect(renderTemplate("Thanks {reviewer_first_name}! — {business_name}", { reviewer_first_name: null, business_name: "Acme" })).toBe("Thanks there! — Acme");
  });
});

describe("approval policy", () => {
  it("applies post approval modes", () => {
    expect(postRequiresApproval("none", { imageMode: "branded", imageSource: "ai_generated" }).required).toBe(false);
    expect(postRequiresApproval("all", { imageMode: "none", imageSource: "none" }).required).toBe(true);
    expect(postRequiresApproval("branded_or_ai", { imageMode: "raw", imageSource: "ai_generated" }).required).toBe(true);
    expect(postRequiresApproval("branded_or_ai", { imageMode: "branded", imageSource: "uploaded" }).required).toBe(true);
    expect(postRequiresApproval("branded_or_ai", { imageMode: "raw", imageSource: "uploaded" }).required).toBe(false);
  });
  it("forces approval when validation fails", () => {
    const d = finalApprovalDecision({ required: false, reason: null }, { ok: false, issues: [{ severity: "error", message: "Claims 24/7" }] });
    expect(d).toEqual({ required: true, reason: "Needs review: Claims 24/7" });
  });
  it("only allows defined task transitions", () => {
    expect(nextTaskStatus("open", "approve")).toBe("approved");
    expect(nextTaskStatus("approved", "approve")).toBeNull();
    expect(nextTaskStatus("completed", "reopen")).toBeNull();
    expect(nextTaskStatus("rejected", "reopen")).toBe("open");
  });
});

describe("permissions", () => {
  it("restricts client approvers to viewing and approving", () => {
    expect(permissionsFor("client_approver").sort()).toEqual(["business.view", "content.approve", "media.approve", "reports.view"]);
    expect(can("client_approver", "content.create")).toBe(false);
    expect(can("client_approver", "integrations.manage")).toBe(false);
  });
  it("keeps org management with owners", () => {
    expect(can("owner", "org.manage")).toBe(true);
    expect(can("admin", "org.manage")).toBe(false);
    expect(can("admin", "members.manage")).toBe(true);
    expect(can("member", "members.manage")).toBe(false);
  });
});
