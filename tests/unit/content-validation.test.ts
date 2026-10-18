import { describe, expect, it } from "vitest";
import { detectInstructionConflicts, validateContent, type FactContext } from "@/lib/content-validation";

const facts: FactContext = { businessName: "Acme Plumbing", phone: "(512) 555-0100", services: ["Drain cleaning"], serviceAreas: ["Austin"], verifiedFacts: ["licensed and insured in texas", "family owned since 2009"] };
const codes = (t: string, kind: Parameters<typeof validateContent>[1]["kind"] = "gbp_post", extra: Partial<Parameters<typeof validateContent>[1]> = {}) => validateContent(t, { kind, facts, ...extra }).issues.map((i) => i.code);

describe("validateContent", () => {
  it("passes plain factual content", () => {
    const r = validateContent("Acme Plumbing clears stubborn drains across Austin. We are licensed and insured. Call (512) 555-0100.", { kind: "gbp_post", facts });
    expect(r.ok).toBe(true);
  });
  it("blocks claims that are not verified facts", () => {
    expect(codes("We offer 24/7 emergency service")).toContain("unsupported_availability");
    expect(codes("Award-winning plumbers")).toContain("unsupported_award");
    expect(codes("The cheapest in town")).toContain("unsupported_superlative_price");
    expect(codes("Drain cleaning from $99")).toContain("unsupported_price");
  });
  it("blocks phone numbers that do not match the business", () => {
    expect(codes("Call 512-555-9999 today")).toContain("phone_mismatch");
    expect(codes("Call +1 512 555 0100 today")).not.toContain("phone_mismatch");
  });
  it("enforces length limits and catches placeholders", () => {
    expect(codes("x".repeat(20), "gbp_post", { maxLength: 10 })).toContain("too_long");
    expect(codes("Visit us in [city]")).toContain("placeholder");
    expect(codes("   ")).toContain("empty");
  });
  it("flags risky review replies", () => {
    expect(codes("This is a fake review", "review_reply")).toContain("argumentative");
    expect(codes("Here is a discount on your next visit", "review_reply")).toContain("incentive");
  });
  it("detects near-duplicates of recent content", () => {
    const t = "Spring is here and Acme Plumbing is ready to help with outdoor faucets and sprinkler lines.";
    const r = validateContent(t, { kind: "gbp_post", facts, recentContent: [t] });
    expect(r.issues.find((i) => i.code === "near_duplicate")?.severity).toBe("error");
  });
  it("warns when a training instruction asks for an unverified claim", () => {
    expect(detectInstructionConflicts("Always say we are the cheapest", facts).map((i) => i.code)).toContain("instruction_unsupported_superlative_price");
    expect(detectInstructionConflicts("Mention we are licensed", facts)).toHaveLength(0);
  });
});
