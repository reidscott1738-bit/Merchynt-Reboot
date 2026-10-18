/**
 * Transparent profile optimization score. Every point is attributable to a
 * named, measurable criterion. This is our own scoring model: Google does not
 * assign it and a higher score does not guarantee better rankings.
 */
export type ScoreInput = {
  name: string | null;
  primaryCategory: string | null;
  secondaryCategories: string[];
  description: string | null;
  phone: string | null;
  website: string | null;
  hasAddressOrServiceArea: boolean;
  hasHours: boolean;
  activeServices: number;
  servicesWithDescriptions: number;
  confirmedAttributes: number;
  suggestedAttributesPending: number;
  reviewsLast180: number;
  repliedLast180: number;
  imagesLast90: number;
  totalApprovedImages: number;
  postsLast30: number;
  websiteMatchesProfile: boolean | null; // null = not checked
  unverifiedCriticalFacts: number;
};

export type ScoreItem = { key: string; label: string; earned: number; possible: number; detail: string };

export function computeOptimizationScore(i: ScoreInput): { score: number; breakdown: ScoreItem[] } {
  const items: ScoreItem[] = [];
  const add = (key: string, label: string, possible: number, earned: number, detail: string) =>
    items.push({ key, label, possible, earned: Math.max(0, Math.min(possible, Math.round(earned * 10) / 10)), detail });

  const required = [i.name, i.primaryCategory, i.phone, i.website].filter(Boolean).length + (i.hasAddressOrServiceArea ? 1 : 0) + (i.hasHours ? 1 : 0);
  add("completeness", "Required profile information", 20, (required / 6) * 20, `${required} of 6 core fields present (name, category, phone, website, address/service area, hours)`);

  const catPts = (i.primaryCategory ? 6 : 0) + Math.min(i.secondaryCategories.length, 2) * 2;
  add("categories", "Categories", 10, catPts, i.primaryCategory ? `Primary category set; ${i.secondaryCategories.length} secondary` : "No primary category");

  const len = i.description?.trim().length ?? 0;
  const descPts = len === 0 ? 0 : len < 250 ? 4 : len < 500 ? 8 : 12;
  add("description", "Business description", 12, descPts, len ? `${len} characters (up to 750 allowed)` : "No description");

  const svcPts = i.activeServices === 0 ? 0 : Math.min(i.activeServices, 5) * 1.6 + (i.servicesWithDescriptions / Math.max(i.activeServices, 1)) * 4;
  add("services", "Services and descriptions", 12, svcPts, `${i.activeServices} services, ${i.servicesWithDescriptions} with descriptions`);

  add("attributes", "Attributes", 6, Math.min(i.confirmedAttributes, 4) * 1.5, `${i.confirmedAttributes} confirmed; ${i.suggestedAttributesPending} awaiting confirmation`);

  const coverage = i.reviewsLast180 === 0 ? 1 : i.repliedLast180 / i.reviewsLast180;
  add("reviews", "Review response coverage", 15, coverage * 15, i.reviewsLast180 ? `${i.repliedLast180} of ${i.reviewsLast180} reviews from the last 180 days have replies` : "No reviews in the last 180 days");

  const mediaPts = Math.min(i.imagesLast90, 6) * 1.5 + (i.totalApprovedImages >= 10 ? 3 : i.totalApprovedImages >= 5 ? 1.5 : 0);
  add("media", "Recent, relevant photos", 12, mediaPts, `${i.imagesLast90} approved photos added in the last 90 days, ${i.totalApprovedImages} total`);

  add("posts", "Recent posts", 5, Math.min(i.postsLast30, 4) * 1.25, `${i.postsLast30} posts published in the last 30 days`);

  add(
    "consistency",
    "Website consistency",
    5,
    i.websiteMatchesProfile == null ? 0 : i.websiteMatchesProfile ? 5 : 1,
    i.websiteMatchesProfile == null ? "Not checked yet — run a website audit" : i.websiteMatchesProfile ? "Website name and phone match the profile" : "Website details differ from the profile",
  );

  add("facts", "Verified business facts", 3, i.unverifiedCriticalFacts === 0 ? 3 : Math.max(0, 3 - i.unverifiedCriticalFacts), i.unverifiedCriticalFacts ? `${i.unverifiedCriticalFacts} important facts still need confirmation` : "Key facts are verified");

  const possible = items.reduce((s, x) => s + x.possible, 0);
  const earned = items.reduce((s, x) => s + x.earned, 0);
  return { score: Math.round((earned / possible) * 100), breakdown: items };
}
