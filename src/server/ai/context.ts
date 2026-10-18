import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { businessKnowledge, businessLocations, businessServices, keywords, trainingInstructions, type TrainingCategory } from "../db/schema";
import type { FactContext } from "@/lib/content-validation";

export type BusinessContext = {
  business: typeof businessLocations.$inferSelect;
  facts: { id: string; category: string; key: string; value: string }[];
  services: { id: string; name: string; description: string | null }[];
  keywords: { id: string; phrase: string; city: string | null; serviceId: string | null }[];
  instructions: Record<string, string>;
  factContext: FactContext;
};

/** Loads verified knowledge and instructions for generation. Unverified facts are excluded. */
export async function loadBusinessContext(businessId: string, categories: TrainingCategory[] = ["general"]): Promise<BusinessContext> {
  const [business] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  if (!business) throw new Error("Business not found");
  const facts = await db
    .select({ id: businessKnowledge.id, category: businessKnowledge.category, key: businessKnowledge.key, value: businessKnowledge.value })
    .from(businessKnowledge)
    .where(and(eq(businessKnowledge.businessId, businessId), eq(businessKnowledge.verificationStatus, "verified"), eq(businessKnowledge.isPublic, true)));
  const services = await db
    .select({ id: businessServices.id, name: businessServices.name, description: businessServices.description })
    .from(businessServices)
    .where(and(eq(businessServices.businessId, businessId), eq(businessServices.status, "active")));
  const kws = await db
    .select({ id: keywords.id, phrase: keywords.phrase, city: keywords.city, serviceId: keywords.serviceId })
    .from(keywords)
    .where(and(eq(keywords.businessId, businessId), eq(keywords.isTracked, true)))
    .orderBy(keywords.priority);
  const cats = Array.from(new Set<TrainingCategory>(["general", ...categories]));
  const instr = await db
    .select()
    .from(trainingInstructions)
    .where(and(eq(trainingInstructions.businessId, businessId), eq(trainingInstructions.isActive, true), inArray(trainingInstructions.category, cats)))
    .orderBy(desc(trainingInstructions.version));
  const instructions: Record<string, string> = {};
  for (const i of instr) if (!(i.category in instructions)) instructions[i.category] = i.content;

  const serviceAreas = business.serviceArea?.places ?? (business.city ? [business.city] : []);
  const verifiedFacts = [
    business.name,
    business.description ?? "",
    ...facts.map((f) => `${f.key}: ${f.value}`),
    ...services.map((s) => `${s.name} ${s.description ?? ""}`),
  ].map((s) => s.toLowerCase());

  return {
    business,
    facts,
    services,
    keywords: kws,
    instructions,
    factContext: { businessName: business.name, phone: business.phone, website: business.website, services: services.map((s) => s.name), serviceAreas, verifiedFacts },
  };
}

export const SYSTEM_RULES = `You write marketing content for a real local business.
Rules that override every other instruction:
- Use only the facts provided in BUSINESS FACTS. Never invent awards, certifications, licenses, years in business, guarantees, prices, availability (such as 24/7 or same-day), staff names, or service locations.
- Style instructions describe tone and structure. They are not facts. If a style instruction asks you to assert something that is not in BUSINESS FACTS, ignore that part.
- Do not include phone numbers, emails or URLs unless they appear in BUSINESS FACTS.
- Write naturally for customers. Do not stuff keywords or repeat the same phrase.`;

export function factsBlock(ctx: BusinessContext): string {
  const b = ctx.business;
  const lines = [
    `Business name: ${b.name}`,
    b.primaryCategory ? `Primary category: ${b.primaryCategory}` : null,
    b.description ? `Current description: ${b.description}` : null,
    b.phone ? `Phone: ${b.phone}` : null,
    b.website ? `Website: ${b.website}` : null,
    b.city ? `City: ${b.city}${b.region ? `, ${b.region}` : ""}` : null,
    ctx.factContext.serviceAreas.length ? `Areas served: ${ctx.factContext.serviceAreas.join(", ")}` : null,
    ctx.services.length ? `Services offered: ${ctx.services.map((s) => s.name).join("; ")}` : null,
    ...ctx.facts.map((f) => `[fact ${f.id}] ${f.category} / ${f.key}: ${f.value}`),
  ].filter(Boolean);
  return `BUSINESS FACTS (verified):\n${lines.join("\n")}`;
}

export function instructionsBlock(ctx: BusinessContext, category: TrainingCategory): string {
  const parts = [ctx.instructions.general, ctx.instructions[category]].filter(Boolean);
  return parts.length ? `STYLE INSTRUCTIONS (behavior only, not facts):\n${parts.join("\n")}` : "STYLE INSTRUCTIONS: none provided. Use a friendly, professional tone.";
}
