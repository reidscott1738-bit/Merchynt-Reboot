import type { ValidationIssue, ValidationResult } from "@/server/db/schema";
import { normalizePhone, textSimilarity } from "./text";

export type FactContext = {
  businessName: string;
  phone?: string | null;
  website?: string | null;
  services: string[];
  serviceAreas: string[];
  /** Verified knowledge values, lower-cased, used to support claims. */
  verifiedFacts: string[];
};

export const PLATFORM_LIMITS = {
  gbp_post: 1500,
  gbp_description: 750,
  review_reply: 4096,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  meta_title: 60,
  meta_description: 160,
  faq_answer: 1200,
} as const;

/**
 * Claim patterns that must be backed by a verified fact before publishing.
 * Each entry names the fact keywords that would support it.
 */
const CLAIM_RULES: { code: string; re: RegExp; supportedBy: RegExp; message: string }[] = [
  { code: "unsupported_superlative_price", re: /\b(cheapest|lowest price[sd]?|best price[sd]?|most affordable)\b/i, supportedBy: /\b(price match|lowest price guarantee|cheapest)\b/i, message: "Makes a price superiority claim that is not in verified business facts" },
  { code: "unsupported_award", re: /\b(award[- ]winning|voted (?:#?1|best)|best of \w+|#1 rated|number one)\b/i, supportedBy: /\b(award|voted|best of)\b/i, message: "Mentions an award or ranking that is not in verified business facts" },
  { code: "unsupported_years", re: /\b(\d{1,3})\+?\s+years? (?:of )?(?:experience|in business|serving)\b/i, supportedBy: /\byears?\b/i, message: "States years of experience that are not in verified business facts" },
  { code: "unsupported_guarantee", re: /\b(guarantee[ds]?|warrant(?:y|ied)|money[- ]back)\b/i, supportedBy: /\b(guarantee|warranty|money[- ]back)\b/i, message: "Mentions a guarantee or warranty that is not in verified business facts" },
  { code: "unsupported_credential", re: /\b(licensed|certified|insured|bonded|accredited)\b/i, supportedBy: /\b(licensed|certified|insured|bonded|accredited|license)\b/i, message: "Claims a license or certification that is not in verified business facts" },
  { code: "unsupported_availability", re: /\b(24\/7|24 hours|around the clock|same[- ]day|emergency service)\b/i, supportedBy: /\b(24\/7|24 hours|around the clock|same[- ]day|emergency)\b/i, message: "Claims availability (24/7, same-day, emergency) that is not in verified business facts" },
  { code: "unsupported_price", re: /\$\s?\d/, supportedBy: /\$\s?\d/, message: "Quotes a price that is not in verified business facts" },
];

const PRIVATE_INFO = [
  { code: "contains_email", re: /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, message: "Contains an email address" },
  { code: "contains_card", re: /\b(?:\d[ -]*?){13,16}\b/, message: "Contains what looks like a card or account number" },
];

const REVIEW_REPLY_RISKS = [
  { code: "admission_of_liability", re: /\b(our fault|we are liable|we were negligent|we admit)\b/i, message: "Reads as an admission of liability" },
  { code: "argumentative", re: /\b(you(?:'re| are) (?:wrong|lying)|that never happened|fake review)\b/i, message: "Argues with the reviewer" },
  { code: "customer_record_disclosure", re: /\b(your (?:invoice|account|order|appointment) (?:#|number)|on your (?:visit|appointment) on \w+ \d)/i, message: "May disclose customer records" },
  { code: "incentive", re: /\b(discount|coupon|free .* for (?:a|your) review|in exchange for)\b/i, message: "Mentions an incentive, which review policies prohibit in replies" },
];

export type ValidateOptions = {
  kind: "gbp_post" | "review_reply" | "faq" | "description" | "website" | "social" | "video_script";
  maxLength?: number;
  facts: FactContext;
  recentContent?: string[];
  /** Raised similarity threshold for duplicates; default 0.6 */
  duplicateThreshold?: number;
};

export function validateContent(text: string, opts: ValidateOptions): ValidationResult {
  const issues: ValidationIssue[] = [];
  const t = text.trim();
  const factsBlob = opts.facts.verifiedFacts.join(" \n ").toLowerCase();

  if (!t) issues.push({ code: "empty", severity: "error", message: "Content is empty" });
  if (opts.maxLength && t.length > opts.maxLength) {
    issues.push({ code: "too_long", severity: "error", message: `Content is ${t.length} characters; the limit is ${opts.maxLength}` });
  }

  for (const rule of CLAIM_RULES) {
    const m = rule.re.exec(t);
    if (!m) continue;
    const phrase = m[0].toLowerCase();
    const supported = factsBlob.includes(phrase) || (rule.supportedBy.test(factsBlob) && phrase.split(/\s+/).some((w) => w.length > 3 && factsBlob.includes(w)));
    if (!supported) issues.push({ code: rule.code, severity: "error", message: `${rule.message}: “${m[0]}”` });
  }

  for (const p of PRIVATE_INFO) {
    const m = p.re.exec(t);
    if (!m) continue;
    // A business's own public email is fine.
    if (p.code === "contains_email" && factsBlob.includes(m[0].toLowerCase())) continue;
    issues.push({ code: p.code, severity: "error", message: p.message });
  }

  // Phone numbers in content must match the business phone.
  const phones = t.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? [];
  const bizPhone = opts.facts.phone ? normalizePhone(opts.facts.phone) : null;
  for (const ph of phones) {
    if (!bizPhone || normalizePhone(ph) !== bizPhone) {
      issues.push({ code: "phone_mismatch", severity: "error", message: `Phone number ${ph} does not match the business phone on file` });
    }
  }

  if (opts.kind === "review_reply") {
    for (const r of REVIEW_REPLY_RISKS) if (r.re.test(t)) issues.push({ code: r.code, severity: "error", message: r.message });
  }

  if (/\{\{|\}\}|\[(?:insert|business name|city)\]|lorem ipsum/i.test(t)) {
    issues.push({ code: "placeholder", severity: "error", message: "Contains placeholder text" });
  }

  // Keyword stuffing: any 2+ word phrase repeated 4+ times.
  const words = t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const bigrams = new Map<string, number>();
  for (let i = 0; i < words.length - 1; i++) {
    const bg = `${words[i]} ${words[i + 1]}`;
    if (words[i].length < 3 || words[i + 1].length < 3) continue;
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  const stuffed = [...bigrams.entries()].find(([, c]) => c >= 4);
  if (stuffed) issues.push({ code: "keyword_stuffing", severity: "warning", message: `Repeats “${stuffed[0]}” ${stuffed[1]} times` });

  const threshold = opts.duplicateThreshold ?? 0.6;
  for (const prev of opts.recentContent ?? []) {
    const sim = textSimilarity(t, prev);
    if (sim >= threshold) {
      issues.push({ code: "near_duplicate", severity: sim >= 0.85 ? "error" : "warning", message: `Very similar (${Math.round(sim * 100)}%) to recent content` });
      break;
    }
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

/**
 * Instructions such as "always say we're the cheapest" are behavioral, not
 * facts. This flags instructions that ask the AI to assert unverified claims.
 */
export function detectInstructionConflicts(instruction: string, facts: FactContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const factsBlob = facts.verifiedFacts.join(" ").toLowerCase();
  for (const rule of CLAIM_RULES) {
    const m = rule.re.exec(instruction);
    if (m && !rule.supportedBy.test(factsBlob)) {
      issues.push({
        code: `instruction_${rule.code}`,
        severity: "warning",
        message: `This instruction asks for a claim (“${m[0]}”) that is not a verified fact. Generated content will be blocked from publishing that claim until it is verified in Business Knowledge.`,
      });
    }
  }
  if (instruction.length > 2000) issues.push({ code: "instruction_too_long", severity: "warning", message: "Long instructions can degrade output quality. Keep them focused." });
  const lines = instruction.split(/\n+/).map((l) => l.trim().toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i].replace(/^(always|never|don't|do not)\s+/, "");
      const b = lines[j].replace(/^(always|never|don't|do not)\s+/, "");
      const aNeg = /^(never|don't|do not)/.test(lines[i]);
      const bNeg = /^(never|don't|do not)/.test(lines[j]);
      if (a && a === b && aNeg !== bNeg) {
        issues.push({ code: "instruction_self_conflict", severity: "warning", message: `Conflicting instructions: “${lines[i]}” and “${lines[j]}”` });
      }
    }
  }
  return issues;
}
