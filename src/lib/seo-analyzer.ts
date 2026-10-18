import { parse, type HTMLElement } from "node-html-parser";
import { PLATFORM_LIMITS } from "./content-validation";
import { normalizePhone } from "./text";

export type ExtractedPage = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robots: string | null;
  lang: string | null;
  viewport: boolean;
  h1: string[];
  headings: { level: number; text: string }[];
  images: { src: string; alt: string | null }[];
  internalLinks: string[];
  externalLinks: string[];
  jsonLd: unknown[];
  jsonLdErrors: string[];
  phonesFound: string[];
  wordCount: number;
  widgets: { reviews: boolean; gallery: boolean; posts: boolean; detectedBy: string[] };
  faqDetected: boolean;
};

export function extractPage(html: string, url: string): ExtractedPage {
  const root = parse(html, { comment: false });
  const base = new URL(url);
  const meta = (name: string) => root.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() ?? null;
  const headings = root.querySelectorAll("h1,h2,h3,h4,h5,h6").map((h) => ({ level: Number(h.tagName[1]), text: h.text.trim().replace(/\s+/g, " ") }));
  const images = root.querySelectorAll("img").map((img) => ({ src: img.getAttribute("src") ?? "", alt: img.hasAttribute("alt") ? (img.getAttribute("alt") ?? "") : null }));
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const a of root.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      (u.host === base.host ? internal : external).add(u.toString().split("#")[0]);
    } catch {
      /* ignore malformed */
    }
  }
  const jsonLd: unknown[] = [];
  const jsonLdErrors: string[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const v = JSON.parse(s.rawText);
      if (Array.isArray(v)) jsonLd.push(...v);
      else if (v && typeof v === "object" && "@graph" in v) jsonLd.push(...((v as { "@graph": unknown[] })["@graph"] ?? []));
      else jsonLd.push(v);
    } catch (e) {
      jsonLdErrors.push(`Invalid JSON-LD: ${(e as Error).message}`);
    }
  }
  const bodyText = (root.querySelector("body") ?? root).text.replace(/\s+/g, " ").trim();
  const phones = [...new Set((bodyText.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? []).map(normalizePhone))];
  for (const a of root.querySelectorAll('a[href^="tel:"]')) phones.push(normalizePhone(a.getAttribute("href") ?? ""));

  const detectedBy: string[] = [];
  const has = (sel: string, label: string) => {
    if (root.querySelector(sel)) {
      detectedBy.push(label);
      return true;
    }
    return false;
  };
  const reviews = has("[data-lp-widget=reviews]", "reviews widget embed") || /elfsight|trustindex|birdeye|podium.*review|google-reviews/i.test(html);
  const gallery = has("[data-lp-widget=gallery]", "gallery widget embed") || root.querySelectorAll("img").length >= 8;
  const posts = has("[data-lp-widget=posts]", "posts widget embed");
  const faqDetected = jsonLd.some((d) => (d as Record<string, unknown>)?.["@type"] === "FAQPage") || headings.some((h) => /faq|frequently asked/i.test(h.text));

  return {
    url,
    title: root.querySelector("title")?.text.trim() || null,
    metaDescription: meta("description"),
    canonical: root.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: meta("robots"),
    lang: root.querySelector("html")?.getAttribute("lang") ?? null,
    viewport: Boolean(meta("viewport")),
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    headings,
    images,
    internalLinks: [...internal].slice(0, 200),
    externalLinks: [...external].slice(0, 200),
    jsonLd,
    jsonLdErrors,
    phonesFound: [...new Set(phones)].filter(Boolean),
    wordCount: bodyText ? bodyText.split(" ").length : 0,
    widgets: { reviews, gallery, posts, detectedBy },
    faqDetected,
  };
}

export type SeoRec = {
  element: string;
  currentValue: string | null;
  recommendedValue: string | null;
  status: "needs_work" | "optimized" | "pending" | "unverifiable";
  basis: "detected" | "recommendation" | "assumption";
  explanation: string;
  confidence: number;
  instructions?: string;
};

export type BusinessForSeo = { name: string; primaryService: string | null; city: string | null; phone: string | null; description: string | null };

export function recommendTitle(b: BusinessForSeo): string {
  const parts = [b.primaryService ? `${b.primaryService}${b.city ? ` in ${b.city}` : ""}` : b.city, b.name].filter(Boolean);
  return parts.join(" | ").slice(0, PLATFORM_LIMITS.meta_title);
}

export function analyzePage(p: ExtractedPage, b: BusinessForSeo, opts: { proposedDescription?: string | null } = {}): SeoRec[] {
  const recs: SeoRec[] = [];
  const title = p.title;
  const svc = b.primaryService?.toLowerCase();
  const city = b.city?.toLowerCase();

  // Title
  if (!title) {
    recs.push({ element: "Homepage title", currentValue: null, recommendedValue: recommendTitle(b), status: "needs_work", basis: "detected", explanation: "No <title> tag was found. The title is the main headline search engines show.", confidence: 0.95 });
  } else {
    const problems: string[] = [];
    if (title.length > 65) problems.push(`is ${title.length} characters and may be cut off`);
    if (title.length < 15) problems.push("is very short");
    if (svc && !title.toLowerCase().includes(svc.split(" ")[0])) problems.push("does not mention the primary service");
    if (!title.toLowerCase().includes(b.name.toLowerCase().split(" ")[0])) problems.push("does not include the business name");
    if ((title.match(/[|,-]/g) ?? []).length > 4) problems.push("looks like a list of keywords");
    recs.push(
      problems.length
        ? { element: "Homepage title", currentValue: title, recommendedValue: recommendTitle(b), status: "needs_work", basis: "detected", explanation: `The current title ${problems.join(", ")}.`, confidence: 0.8 }
        : { element: "Homepage title", currentValue: title, recommendedValue: null, status: "optimized", basis: "detected", explanation: "Title is descriptive, concise and names the business.", confidence: 0.8 },
    );
  }

  // Meta description
  const md = p.metaDescription;
  if (!md) {
    recs.push({ element: "Meta description", currentValue: null, recommendedValue: opts.proposedDescription ?? null, status: opts.proposedDescription ? "needs_work" : "pending", basis: "detected", explanation: "No meta description was found. Search engines may pick arbitrary page text instead.", confidence: 0.95 });
  } else if (md.length > 165 || md.length < 70) {
    recs.push({ element: "Meta description", currentValue: md, recommendedValue: opts.proposedDescription ?? null, status: "needs_work", basis: "detected", explanation: `Meta description is ${md.length} characters; 70–160 reads best in results.`, confidence: 0.75 });
  } else {
    recs.push({ element: "Meta description", currentValue: md, recommendedValue: null, status: "optimized", basis: "detected", explanation: "Meta description length and content look reasonable.", confidence: 0.7 });
  }

  // H1
  if (p.h1.length === 0) recs.push({ element: "H1 heading", currentValue: null, recommendedValue: b.primaryService && b.city ? `${b.primaryService} in ${b.city}` : b.name, status: "needs_work", basis: "detected", explanation: "The page has no H1 heading.", confidence: 0.9 });
  else if (p.h1.length > 1) recs.push({ element: "H1 heading", currentValue: p.h1.join(" / "), recommendedValue: p.h1[0], status: "needs_work", basis: "detected", explanation: `The page has ${p.h1.length} H1 headings; one clear H1 is recommended.`, confidence: 0.7 });
  else recs.push({ element: "H1 heading", currentValue: p.h1[0], recommendedValue: null, status: "optimized", basis: "detected", explanation: "One H1 heading found.", confidence: 0.85 });

  // Heading order
  let skipped = false;
  for (let i = 1; i < p.headings.length; i++) if (p.headings[i].level - p.headings[i - 1].level > 1) skipped = true;
  if (skipped) recs.push({ element: "Heading hierarchy", currentValue: p.headings.slice(0, 8).map((h) => `H${h.level}`).join(" → "), recommendedValue: null, status: "needs_work", basis: "detected", explanation: "Heading levels skip (for example H1 to H3), which makes the structure harder to parse.", confidence: 0.6 });

  // Images
  const missingAlt = p.images.filter((i) => i.alt == null || i.alt.trim() === "");
  if (p.images.length) {
    recs.push(
      missingAlt.length
        ? { element: "Image alt text", currentValue: `${missingAlt.length} of ${p.images.length} images missing alt text`, recommendedValue: "Describe what each image shows", status: "needs_work", basis: "detected", explanation: "Alt text describes images for screen readers and search engines.", confidence: 0.85 }
        : { element: "Image alt text", currentValue: `${p.images.length} images with alt text`, recommendedValue: null, status: "optimized", basis: "detected", explanation: "All images have alt text.", confidence: 0.85 },
    );
  }

  // Canonical / robots / viewport
  if (!p.canonical) recs.push({ element: "Canonical URL", currentValue: null, recommendedValue: p.url, status: "needs_work", basis: "detected", explanation: "No canonical link tag. A canonical URL avoids duplicate-page confusion.", confidence: 0.7 });
  else recs.push({ element: "Canonical URL", currentValue: p.canonical, recommendedValue: null, status: "optimized", basis: "detected", explanation: "Canonical URL is set.", confidence: 0.8 });
  if (p.robots && /noindex/i.test(p.robots)) recs.push({ element: "Robots directive", currentValue: p.robots, recommendedValue: "index, follow", status: "needs_work", basis: "detected", explanation: "The homepage tells search engines not to index it.", confidence: 0.95 });
  if (!p.viewport) recs.push({ element: "Mobile viewport", currentValue: null, recommendedValue: '<meta name="viewport" content="width=device-width, initial-scale=1">', status: "needs_work", basis: "detected", explanation: "No viewport meta tag; the page may not render well on phones.", confidence: 0.9 });

  // Schema
  const types = p.jsonLd.map((d) => String((d as Record<string, unknown>)?.["@type"] ?? "")).filter(Boolean);
  const hasLocal = types.some((t) => /LocalBusiness|Plumber|Electrician|HVAC|Roofing|Contractor|Dentist|Restaurant|Salon|Service|AutoRepair|Locksmith/i.test(t));
  if (p.jsonLdErrors.length) recs.push({ element: "Schema markup", currentValue: p.jsonLdErrors.join("; "), recommendedValue: "Replace with the generated LocalBusiness JSON-LD", status: "needs_work", basis: "detected", explanation: "Existing structured data could not be parsed.", confidence: 0.95 });
  else if (!hasLocal) recs.push({ element: "Schema markup", currentValue: types.length ? types.join(", ") : null, recommendedValue: "LocalBusiness JSON-LD (see Schema tab)", status: "needs_work", basis: "detected", explanation: "No LocalBusiness structured data was detected. Structured data helps machines read business details; it does not guarantee rankings or AI citations.", confidence: 0.85, instructions: "Paste the generated script tag into your site's <head>." });
  else recs.push({ element: "Schema markup", currentValue: types.join(", "), recommendedValue: null, status: "optimized", basis: "detected", explanation: "LocalBusiness structured data was found.", confidence: 0.8 });

  // NAP consistency
  if (b.phone) {
    const biz = normalizePhone(b.phone);
    if (p.phonesFound.length === 0) recs.push({ element: "Phone number on page", currentValue: null, recommendedValue: b.phone, status: "needs_work", basis: "detected", explanation: "The business phone number was not found on the homepage.", confidence: 0.65 });
    else if (!p.phonesFound.includes(biz)) recs.push({ element: "Phone number on page", currentValue: p.phonesFound.join(", "), recommendedValue: b.phone, status: "needs_work", basis: "detected", explanation: "Phone numbers on the page do not match the profile phone.", confidence: 0.7 });
    else recs.push({ element: "Phone number on page", currentValue: b.phone, recommendedValue: null, status: "optimized", basis: "detected", explanation: "Profile phone appears on the page.", confidence: 0.8 });
  }

  // FAQ
  recs.push(
    p.faqDetected
      ? { element: "FAQ content", currentValue: "FAQ section detected", recommendedValue: null, status: "optimized", basis: "detected", explanation: "The page has FAQ content.", confidence: 0.6 }
      : { element: "FAQ content", currentValue: null, recommendedValue: "Publish approved FAQs (see FAQs tab)", status: "needs_work", basis: "recommendation", explanation: "No FAQ section was detected. Answers to real customer questions are useful to visitors and to AI assistants; they do not guarantee AI mentions.", confidence: 0.5 },
  );

  // Widgets: detection can miss content rendered by other mechanisms.
  for (const [key, label] of [["reviews", "Reviews widget"], ["gallery", "Photo gallery"], ["posts", "Recent posts widget"]] as const) {
    recs.push(
      p.widgets[key]
        ? { element: label, currentValue: "Detected", recommendedValue: null, status: "optimized", basis: "detected", explanation: `Detected via ${p.widgets.detectedBy.join(", ") || "page content"}.`, confidence: 0.6 }
        : { element: label, currentValue: "Not detected", recommendedValue: "Install the embed code from the Widgets tab", status: "unverifiable", basis: "assumption", explanation: "Not found in the page HTML. It may still exist if loaded by a script or iframe, so confirm visually before acting.", confidence: 0.4 },
    );
  }

  if (p.wordCount < 250) recs.push({ element: "Content depth", currentValue: `${p.wordCount} words`, recommendedValue: "Describe services, areas served and how to book", status: "needs_work", basis: "detected", explanation: "The page has little readable text, which gives search engines and visitors less to go on.", confidence: 0.55 });

  return recs;
}
