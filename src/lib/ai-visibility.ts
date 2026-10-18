import { normalizeKeyword } from "./text";

export const QUERY_TEMPLATE_VERSION = "v1";

const TEMPLATES = [
  "Who is the best {keyword} in {city}?",
  "Can you recommend a good {keyword} near {city}?",
  "I need {keyword} in {city}. Which local companies should I call?",
];

export function buildQueries(keyword: string, city: string | null, count = 1): string[] {
  const c = city?.trim() || "my area";
  const k = keyword.trim().replace(/\s+in\s+[\w\s]+$/i, "");
  return TEMPLATES.slice(0, Math.max(1, Math.min(count, TEMPLATES.length))).map((t) => t.replaceAll("{keyword}", k).replaceAll("{city}", c));
}

/** Extracts candidate business names from an AI answer in order of appearance. */
export function extractBusinessMentions(answer: string): string[] {
  const names: string[] = [];
  const push = (n: string) => {
    const clean = n.replace(/\*\*|__/g, "").replace(/[:–—-]+$/, "").trim();
    if (clean.length >= 3 && clean.length <= 80 && !names.some((x) => x.toLowerCase() === clean.toLowerCase())) names.push(clean);
  };
  for (const line of answer.split(/\n+/)) {
    // Numbered or bulleted list items: "1. **Acme Plumbing** - ..."
    const m = /^\s*(?:\d+[.)]|[-*•])\s+\**([^*\n:–—]+?)\**\s*(?:[:–—-]|\(|$)/.exec(line);
    if (m) push(m[1]);
    for (const b of line.matchAll(/\*\*([^*]{3,80})\*\*/g)) push(b[1]);
  }
  return names;
}

const STOP = new Set(["the", "and", "llc", "inc", "co", "company", "of", "&", "services", "service", "group"]);

function tokens(s: string) {
  return normalizeKeyword(s).split(" ").filter((t) => t && !STOP.has(t));
}

/**
 * Business identity matching: a mention matches the target when most of the
 * distinctive name tokens appear, or the website domain is cited.
 */
export function matchesBusiness(mention: string, target: { name: string; domain?: string | null }): { match: boolean; reason?: string } {
  const t = tokens(target.name);
  const m = new Set(tokens(mention));
  if (t.length === 0) return { match: false };
  const hit = t.filter((x) => m.has(x)).length;
  if (hit / t.length >= 0.75) return { match: true, reason: `name tokens ${hit}/${t.length}` };
  if (target.domain && mention.toLowerCase().includes(target.domain.toLowerCase())) return { match: true, reason: "domain" };
  return { match: false };
}

export function analyzeAnswer(answer: string, sources: { url: string }[], target: { name: string; domain?: string | null }, depth = 20) {
  const mentions = extractBusinessMentions(answer).slice(0, depth);
  const list = mentions.map((name, i) => {
    const r = matchesBusiness(name, target);
    return { name, position: i + 1, isTarget: r.match, matchReason: r.reason };
  });
  let target_ = list.find((x) => x.isTarget);
  // Fall back to a plain-text mention if the list parser missed it.
  if (!target_ && tokens(target.name).length && normalizeKeyword(answer).includes(normalizeKeyword(target.name))) {
    target_ = { name: target.name, position: list.length + 1, isTarget: true, matchReason: "text mention" };
    list.push(target_);
  }
  const citedDomain = target.domain ? sources.some((s) => s.url.toLowerCase().includes(target.domain!.toLowerCase())) : false;
  return { mentionedBusinesses: list, mentioned: Boolean(target_) || citedDomain, position: target_?.position ?? null, citedDomain };
}
