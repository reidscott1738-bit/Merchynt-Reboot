import { z } from "zod";
import { getAi, type GenerationMeta } from "./provider";
import { factsBlock, instructionsBlock, SYSTEM_RULES, type BusinessContext } from "./context";
import { PLATFORM_LIMITS } from "@/lib/content-validation";
import { truncate } from "@/lib/text";

/**
 * Task-specific generation workflows. Each builds a focused prompt from
 * verified facts plus the relevant Train AI category, and supplies a
 * deterministic demo generator used only when DEMO_MODE is on and no model is
 * configured. Callers validate the output before anything is published.
 */

function cityOf(ctx: BusinessContext) {
  return ctx.business.city ?? ctx.factContext.serviceAreas[0] ?? null;
}
function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

/* ---------------- Google Business Profile posts ---------------- */

const postSchema = z.object({ body: z.string(), angle: z.string() });

export const POST_ANGLES = ["service spotlight", "how it works", "customer tip", "seasonal reminder", "local area", "behind the scenes", "common question"];

export async function generateGbpPost(
  ctx: BusinessContext,
  input: { keyword?: string | null; service?: string | null; imageDescription?: string | null; holiday?: string | null; recentPosts: string[]; seed: number },
): Promise<{ body: string; angle: string; meta: GenerationMeta }> {
  const angle = pick(POST_ANGLES, input.seed);
  const prompt = [
    factsBlock(ctx),
    instructionsBlock(ctx, "google_posts"),
    `TASK: Write one Google Business Profile post (${PLATFORM_LIMITS.gbp_post} characters maximum; aim for 80-180 words).`,
    `Content angle: ${angle}.`,
    input.service ? `Focus service: ${input.service}` : null,
    input.keyword ? `Work this search phrase in once, naturally: "${input.keyword}"` : null,
    input.imageDescription ? `The post image shows: ${input.imageDescription}. Make the text consistent with the image.` : null,
    input.holiday ? `The post goes out near ${input.holiday}; a brief, relevant reference is fine.` : null,
    input.recentPosts.length ? `Recent posts (do not repeat their openings or structure):\n${input.recentPosts.slice(0, 5).map((p) => `- ${truncate(p, 160)}`).join("\n")}` : null,
    "Do not include hashtags. Do not include a phone number or URL; the call-to-action button handles that. Return the post text and the angle you used.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data, meta } = await getAi().json({
    task: "gbp_post",
    system: SYSTEM_RULES,
    prompt,
    effort: "low",
    schema: postSchema,
    demo: () => {
      const svc = input.service ?? ctx.services[input.seed % Math.max(ctx.services.length, 1)]?.name ?? ctx.business.primaryCategory ?? "our services";
      const city = cityOf(ctx);
      const openers = [
        `Looking for ${svc.toLowerCase()}${city ? ` in ${city}` : ""}?`,
        `${ctx.business.name} is here to help with ${svc.toLowerCase()}.`,
        `A quick note from the ${ctx.business.name} team about ${svc.toLowerCase()}.`,
        `Planning ahead for ${svc.toLowerCase()}?`,
      ];
      const middle = ctx.business.description ? truncate(ctx.business.description, 220) : `We focus on ${svc.toLowerCase()} for customers${city ? ` around ${city}` : ""}.`;
      const holiday = input.holiday ? ` Wishing everyone a good ${input.holiday}.` : "";
      return { body: `${pick(openers, input.seed)} ${middle}${holiday} Reach out to learn more or schedule a visit.`, angle };
    },
  });
  return { body: data.body.trim(), angle: data.angle, meta };
}

/* ---------------- Review replies ---------------- */

const replySchema = z.object({
  reply: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  praise: z.array(z.string()),
  complaints: z.array(z.string()),
  requestedResolution: z.string().nullable(),
});

export async function generateReviewReply(
  ctx: BusinessContext,
  review: { reviewerName: string | null; rating: number; text: string | null },
  opts: { signOff?: string; recentReplies: string[] },
) {
  const first = review.reviewerName?.split(/\s+/)[0] ?? null;
  const prompt = [
    factsBlock(ctx),
    instructionsBlock(ctx, "review_replies"),
    `REVIEW (${review.rating} stars) from ${review.reviewerName ?? "a customer"}:\n"""${review.text ?? "(no text, rating only)"}"""`,
    "TASK: Identify sentiment, specific praise, complaints and any requested resolution. Then write a concise, natural owner reply (2-4 sentences).",
    "For negative reviews: acknowledge the concern, do not argue, do not admit legal liability, do not disclose any customer records or appointment details, and invite them to contact the business directly to resolve it.",
    "Never offer discounts or incentives in a review reply. Address the reviewer by first name if known.",
    opts.signOff ? `End with this sign-off: ${opts.signOff}` : null,
    opts.recentReplies.length ? `Recent replies (vary your wording from these):\n${opts.recentReplies.slice(0, 5).map((r) => `- ${truncate(r, 140)}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return getAi().json({
    task: "review_reply",
    system: SYSTEM_RULES,
    prompt,
    effort: "low",
    schema: replySchema,
    demo: () => {
      const name = first ? `${first}, ` : "";
      const positive = review.rating >= 4;
      const reply = positive
        ? `Thank you, ${name}for taking the time to share this. We're glad the experience with ${ctx.business.name} was a good one and appreciate your support.`
        : review.rating === 3
          ? `Thank you for the feedback, ${name}we appreciate you letting us know. We'd like to hear more about how we can do better, so please reach out to us directly.`
          : `${first ? `${first}, w` : "W"}e're sorry to hear about your experience and appreciate you raising it. Please contact ${ctx.business.name} directly so we can look into this and make it right.`;
      return {
        reply: opts.signOff ? `${reply} ${opts.signOff}` : reply,
        sentiment: positive ? "positive" : review.rating === 3 ? "neutral" : "negative",
        praise: [],
        complaints: [],
        requestedResolution: null,
      } satisfies z.infer<typeof replySchema>;
    },
  });
}

/* ---------------- Business description and services ---------------- */

export async function generateBusinessDescription(ctx: BusinessContext, websiteText: string | null) {
  const prompt = [
    factsBlock(ctx),
    instructionsBlock(ctx, "general"),
    websiteText ? `WEBSITE TEXT (reference only; only restate claims that also appear in BUSINESS FACTS):\n${truncate(websiteText, 6000)}` : null,
    `TASK: Write a Google Business Profile description, ${PLATFORM_LIMITS.gbp_description} characters maximum (aim for 500-700). Describe what the business does, the main services and areas served. Mention 1-2 target phrases naturally if they fit: ${ctx.keywords.slice(0, 3).map((k) => k.phrase).join(", ") || "none"}. No URLs, no phone numbers, no promotional pricing.`,
    "Also explain in one sentence why this version is better than the current one.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return getAi().json({
    task: "business_description",
    system: SYSTEM_RULES,
    prompt,
    effort: "medium",
    schema: z.object({ description: z.string(), rationale: z.string() }),
    demo: () => {
      const city = cityOf(ctx);
      const svcs = ctx.services.slice(0, 4).map((s) => s.name.toLowerCase());
      const areas = ctx.factContext.serviceAreas.slice(0, 4);
      const desc = `${ctx.business.name} is a ${ctx.business.primaryCategory?.toLowerCase() ?? "local business"}${city ? ` based in ${city}` : ""}. ${
        svcs.length ? `We provide ${svcs.join(", ")}` : "We serve local customers"
      }${areas.length ? ` for customers in ${areas.join(", ")}` : ""}. ${ctx.business.description ? truncate(ctx.business.description, 250) : ""} Contact us to discuss what you need.`.replace(/\s+/g, " ");
      return { description: truncate(desc, PLATFORM_LIMITS.gbp_description), rationale: "Names the category, core services and service area in plain language." };
    },
  });
}

export async function generateServiceDescriptions(ctx: BusinessContext, serviceNames: string[]) {
  const prompt = [
    factsBlock(ctx),
    instructionsBlock(ctx, "service_descriptions"),
    `TASK: For each service below, write a factual 1-2 sentence description (under 300 characters) a customer would find useful. Do not claim anything not in BUSINESS FACTS.\nServices:\n${serviceNames.map((s) => `- ${s}`).join("\n")}`,
  ].join("\n\n");
  return getAi().json({
    task: "service_descriptions",
    system: SYSTEM_RULES,
    prompt,
    effort: "low",
    schema: z.object({ services: z.array(z.object({ name: z.string(), description: z.string() })) }),
    demo: () => ({
      services: serviceNames.map((name) => ({ name, description: `${ctx.business.name} offers ${name.toLowerCase()}${cityOf(ctx) ? ` for customers in and around ${cityOf(ctx)}` : ""}. Contact us to discuss your project.` })),
    }),
  });
}

export async function suggestServices(ctx: BusinessContext, websiteText: string | null) {
  const prompt = [
    factsBlock(ctx),
    websiteText ? `WEBSITE TEXT:\n${truncate(websiteText, 8000)}` : "No website text is available.",
    "TASK: List services this business appears to genuinely offer based on the website text and category that are NOT already in 'Services offered'. Only include a service when the website text supports it, and quote the supporting phrase as evidence. Also list any current services that look outdated or unrelated to the category, with a reason. Return empty lists if unsure.",
  ].join("\n\n");
  return getAi().json({
    task: "service_suggestions",
    system: SYSTEM_RULES,
    prompt,
    effort: "medium",
    schema: z.object({
      additions: z.array(z.object({ name: z.string(), evidence: z.string() })),
      removals: z.array(z.object({ name: z.string(), reason: z.string() })),
    }),
    demo: () => {
      const existing = new Set(ctx.services.map((s) => s.name.toLowerCase()));
      const additions: { name: string; evidence: string }[] = [];
      if (websiteText) {
        const m = websiteText.match(/\b([A-Z][a-z]+(?: [A-Z]?[a-z]+){0,3} (?:repair|installation|replacement|cleaning|inspection|maintenance|removal|design))\b/g) ?? [];
        for (const name of [...new Set(m)].slice(0, 5)) if (!existing.has(name.toLowerCase())) additions.push({ name, evidence: `Website mentions “${name}”` });
      }
      return { additions, removals: [] };
    },
  });
}

/* ---------------- Website knowledge extraction ---------------- */

export async function extractFactsFromWebsite(ctx: BusinessContext, websiteText: string, url: string) {
  const prompt = [
    `Business name: ${ctx.business.name}`,
    `WEBSITE TEXT from ${url}:\n${truncate(websiteText, 12000)}`,
    "TASK: Extract factual statements the business makes about itself: services, service areas, hours, contact details, policies, pricing, credentials (licenses, certifications, insurance), years in business and differentiators. Quote evidence for each. Do not infer anything that is not stated. These will be shown to the owner to confirm before use.",
  ].join("\n\n");
  return getAi().json({
    task: "website_fact_extraction",
    system: "You extract facts from website text precisely and conservatively. You never add information that is not in the text.",
    prompt,
    effort: "medium",
    schema: z.object({
      facts: z.array(
        z.object({
          category: z.enum(["identity", "contact", "service", "service_area", "hours", "pricing", "policy", "differentiator", "credential", "other"]),
          key: z.string(),
          value: z.string(),
          evidence: z.string(),
        }),
      ),
    }),
    demo: () => {
      const facts: { category: "contact" | "service" | "credential" | "hours"; key: string; value: string; evidence: string }[] = [];
      const phone = websiteText.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0];
      if (phone) facts.push({ category: "contact", key: "Phone (from website)", value: phone, evidence: phone });
      const email = websiteText.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i)?.[0];
      if (email) facts.push({ category: "contact", key: "Email (from website)", value: email, evidence: email });
      for (const m of websiteText.match(/\b(licensed|insured|certified|bonded)(?: and (licensed|insured|certified|bonded))?/gi)?.slice(0, 2) ?? []) {
        facts.push({ category: "credential", key: m.toLowerCase(), value: m, evidence: m });
      }
      return { facts };
    },
  });
}

/* ---------------- FAQs ---------------- */

export async function generateFaqs(ctx: BusinessContext, existingQuestions: string[], count: number) {
  const prompt = [
    factsBlock(ctx),
    instructionsBlock(ctx, "faqs"),
    `TASK: Write ${count} new customer FAQs with concise answers (under 600 characters). Each answer must be supported by BUSINESS FACTS; list the [fact id]s you relied on (may be empty if only the name/services/areas were used). Prefer real customer concerns: what a service includes, areas served, how to book, hours. Skip a topic if the facts don't answer it.`,
    existingQuestions.length ? `Existing questions (do not duplicate):\n${existingQuestions.map((q) => `- ${q}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return getAi().json({
    task: "faqs",
    system: SYSTEM_RULES,
    prompt,
    effort: "medium",
    schema: z.object({ faqs: z.array(z.object({ question: z.string(), answer: z.string(), factIds: z.array(z.string()) })) }),
    demo: () => {
      const b = ctx.business;
      const areas = ctx.factContext.serviceAreas;
      type Faq = { question: string; answer: string; factIds: string[] };
      const candidates: (Faq | null)[] = [
        areas.length ? { question: `What areas does ${b.name} serve?`, answer: `We serve customers in ${areas.join(", ")}.`, factIds: [] } : null,
        ctx.services.length ? { question: `What services does ${b.name} offer?`, answer: `Our services include ${ctx.services.map((s) => s.name.toLowerCase()).join(", ")}.`, factIds: [] } : null,
        b.phone ? { question: `How do I schedule with ${b.name}?`, answer: `Call us at ${b.phone}${b.appointmentUrl ? " or book online" : ""} and we'll find a time that works.`, factIds: [] } : null,
        ...ctx.services.slice(0, 5).map((s) => ({ question: `Do you offer ${s.name.toLowerCase()}?`, answer: `Yes. ${b.name} offers ${s.name.toLowerCase()}${s.description ? `: ${truncate(s.description, 200)}` : "."}`, factIds: [] })),
      ];
      const faqs = candidates.filter((x): x is Faq => x !== null);
      const existing = new Set(existingQuestions.map((q) => q.toLowerCase()));
      return { faqs: faqs.filter((c) => !existing.has(c.question.toLowerCase())).slice(0, count) };
    },
  });
}

/* ---------------- Image metadata ---------------- */

export async function describeImage(ctx: BusinessContext, input: { originalFilename: string | null; userCaption?: string | null; tags: string[] }) {
  const prompt = [
    `Business: ${ctx.business.name} (${ctx.business.primaryCategory ?? "local business"})${cityOf(ctx) ? ` in ${cityOf(ctx)}` : ""}`,
    `Original filename: ${input.originalFilename ?? "unknown"}`,
    input.userCaption ? `Uploader caption: ${input.userCaption}` : null,
    input.tags.length ? `Tags: ${input.tags.join(", ")}` : null,
    "TASK: Propose an SEO-friendly filename (lowercase, hyphens, no extension, under 60 chars) and alt text (under 125 chars) and a one-sentence description. Only describe what the caption, tags or filename indicate; do not guess details you cannot know.",
  ]
    .filter(Boolean)
    .join("\n");
  return getAi().json({
    task: "image_metadata",
    system: "You write accurate, modest image metadata. You never claim where a photo was taken.",
    prompt,
    effort: "low",
    schema: z.object({ seoFilename: z.string(), altText: z.string(), description: z.string() }),
    demo: () => {
      const subject = input.userCaption ?? input.tags.join(" ") ?? ctx.business.primaryCategory ?? "work";
      const base = `${ctx.business.name} ${subject}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58);
      return { seoFilename: base || "business-photo", altText: truncate(`${subject} by ${ctx.business.name}`, 120), description: `Photo from ${ctx.business.name}${input.userCaption ? `: ${input.userCaption}` : ""}.` };
    },
  });
}

/* ---------------- Video scripts ---------------- */

export async function generateVideoScript(ctx: BusinessContext, input: { sceneCount: number; imageDescriptions: (string | null)[]; brief?: string | null; format: string }) {
  const prompt = [
    factsBlock(ctx),
    instructionsBlock(ctx, "video_scripts"),
    ctx.instructions.voice_pronunciation ? `PRONUNCIATION NOTES: ${ctx.instructions.voice_pronunciation}` : null,
    `TASK: Write narration for a ${input.format} slideshow video with exactly ${input.sceneCount} scenes. Each scene narration is one short sentence (6-16 words) that matches its image. Mention the business name in the first scene. Also give a 2-5 word on-screen overlay per scene and closing text.`,
    input.brief ? `Brief: ${input.brief}` : null,
    `Scene images:\n${input.imageDescriptions.map((d, i) => `${i + 1}. ${d ?? "business photo"}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return getAi().json({
    task: "video_script",
    system: SYSTEM_RULES,
    prompt,
    effort: "low",
    schema: z.object({ scenes: z.array(z.object({ narration: z.string(), overlay: z.string() })), endingText: z.string() }),
    demo: () => {
      const svcs = ctx.services.map((s) => s.name);
      const scenes = Array.from({ length: input.sceneCount }, (_, i) => {
        if (i === 0) return { narration: `Meet ${ctx.business.name}${cityOf(ctx) ? `, serving ${cityOf(ctx)}` : ""}.`, overlay: ctx.business.name };
        if (i === input.sceneCount - 1) return { narration: `Reach out to ${ctx.business.name} today.`, overlay: "Get in touch" };
        const s = svcs[(i - 1) % Math.max(svcs.length, 1)] ?? ctx.business.primaryCategory ?? "Local service";
        return { narration: `We help customers with ${s.toLowerCase()}.`, overlay: truncate(s, 28) };
      });
      return { scenes, endingText: ctx.business.phone ? `Call ${ctx.business.phone}` : ctx.business.name };
    },
  });
}

/* ---------------- Website content ---------------- */

const sectionCopy = z.object({ heading: z.string(), body: z.string() });

export async function generateWebsiteCopy(
  ctx: BusinessContext,
  plan: { pageKey: string; sections: { key: string; purpose: string }[] }[],
) {
  const prompt = [
    factsBlock(ctx),
    instructionsBlock(ctx, "website_content"),
    "TASK: Write website copy for the sections below. Each section needs a heading (under 70 chars) and body (40-140 words, plain text, paragraphs separated by blank lines). Make each service page specific to that service. Never claim anything outside BUSINESS FACTS. Do not include phone numbers in body text; the site shows contact details separately.",
    plan.map((p) => `PAGE ${p.pageKey}:\n${p.sections.map((s) => `- ${s.key}: ${s.purpose}`).join("\n")}`).join("\n\n"),
  ].join("\n\n");
  return getAi().json({
    task: "website_copy",
    system: SYSTEM_RULES,
    prompt,
    effort: "medium",
    maxTokens: 32000,
    schema: z.object({ pages: z.array(z.object({ pageKey: z.string(), sections: z.array(z.object({ key: z.string(), heading: z.string(), body: z.string() })) })) }),
    demo: () => ({
      pages: plan.map((p) => ({
        pageKey: p.pageKey,
        sections: p.sections.map((s) => ({ key: s.key, ...demoSection(ctx, s.purpose) })),
      })),
    }),
  });
}

function demoSection(ctx: BusinessContext, purpose: string) {
  const b = ctx.business;
  const city = cityOf(ctx);
  return {
    heading: truncate(purpose.split(":")[0].replace(/^(Introduce|Explain|Describe)\s+/i, ""), 68),
    body: `${b.name} ${city ? `serves customers in ${city}` : "serves local customers"}. ${b.description ? truncate(b.description, 300) : `We focus on ${ctx.services.map((s) => s.name.toLowerCase()).slice(0, 3).join(", ") || "quality work"}.`}`,
  };
}

export async function regenerateSectionCopy(ctx: BusinessContext, input: { pageTitle: string; sectionType: string; current: { heading?: string; body?: string }; instruction: string | null }) {
  const prompt = [
    factsBlock(ctx),
    instructionsBlock(ctx, "website_content"),
    `TASK: Rewrite one website section on the "${input.pageTitle}" page (type: ${input.sectionType}).`,
    `Current heading: ${input.current.heading ?? ""}\nCurrent body:\n${input.current.body ?? ""}`,
    input.instruction ? `Requested change: ${input.instruction}` : "Improve clarity and specificity while keeping the meaning.",
    "Keep the length similar unless the requested change says otherwise.",
  ].join("\n\n");
  return getAi().json({
    task: "website_section",
    system: SYSTEM_RULES,
    prompt,
    effort: "low",
    schema: sectionCopy,
    demo: () => ({ heading: input.current.heading ?? input.pageTitle, body: `${input.current.body ?? ""}${input.instruction ? `\n\n(${input.instruction})` : ""}`.trim() }),
  });
}

/* ---------------- Reports ---------------- */

export async function generateReportNarrative(businessName: string, facts: string[]) {
  const prompt = [
    `Business: ${businessName}`,
    `REPORT DATA (each line is a measured or calculated figure with its source):\n${facts.map((f) => `- ${f}`).join("\n")}`,
    "TASK: Write a 3-5 sentence plain-language summary of this period for the business owner. Only describe what the data shows. If a figure is labeled an estimate, call it an estimate. If data is missing, say so briefly. Do not claim causation or invent improvements.",
  ].join("\n\n");
  return getAi().json({
    task: "report_narrative",
    system: "You summarize marketing data accurately and never overstate results.",
    prompt,
    effort: "low",
    schema: z.object({ summary: z.string() }),
    demo: () => ({ summary: facts.length ? `Here is what was recorded this period for ${businessName}: ${facts.slice(0, 4).join("; ")}.` : `No measured data was available for ${businessName} this period.` }),
  });
}
