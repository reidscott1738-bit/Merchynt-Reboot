import type { ValidationIssue, ValidationResult, WeeklyHours } from "@/server/db/schema";

export type SchemaBusiness = {
  name: string;
  description?: string | null;
  url?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  imageUrls?: string[];
  primaryCategory?: string | null;
  address?: { line1?: string | null; city?: string | null; region?: string | null; postalCode?: string | null; country?: string | null } | null;
  /** Service-area businesses that hide their address must not expose it. */
  hideAddress: boolean;
  geo?: { lat: number; lng: number } | null;
  hours?: WeeklyHours | null;
  serviceAreas?: string[];
  services?: { name: string; description?: string | null }[];
  sameAs?: string[];
  aggregateRating?: { ratingValue: number; reviewCount: number } | null;
};

const DAY_MAP: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

/** Maps a few common GBP categories to schema.org LocalBusiness subtypes. */
export function schemaTypeForCategory(category: string | null | undefined): string {
  const c = (category ?? "").toLowerCase();
  const table: [RegExp, string][] = [
    [/plumb/, "Plumber"],
    [/electric/, "Electrician"],
    [/hvac|heating|air condition/, "HVACBusiness"],
    [/roof/, "RoofingContractor"],
    [/locksmith/, "Locksmith"],
    [/landscap|lawn/, "HomeAndConstructionBusiness"],
    [/contractor|construction|remodel/, "GeneralContractor"],
    [/clean/, "HomeAndConstructionBusiness"],
    [/dentist|dental/, "Dentist"],
    [/restaurant|cafe|pizza|bar\b/, "Restaurant"],
    [/salon|hair/, "HairSalon"],
    [/law|attorney|lawyer/, "LegalService"],
    [/auto|car repair|mechanic/, "AutoRepair"],
    [/real estate/, "RealEstateAgent"],
    [/pest/, "HomeAndConstructionBusiness"],
    [/photograph|studio/, "ProfessionalService"],
  ];
  for (const [re, type] of table) if (re.test(c)) return type;
  return "LocalBusiness";
}

export function buildLocalBusinessJsonLd(b: SchemaBusiness): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaTypeForCategory(b.primaryCategory),
    name: b.name,
  };
  if (b.url) {
    doc["@id"] = `${b.url.replace(/\/$/, "")}/#business`;
    doc.url = b.url;
  }
  if (b.description) doc.description = b.description;
  if (b.phone) doc.telephone = b.phone;
  if (b.email) doc.email = b.email;
  if (b.logoUrl) doc.logo = b.logoUrl;
  if (b.imageUrls?.length) doc.image = b.imageUrls.slice(0, 5);
  if (b.address && !b.hideAddress && b.address.line1) {
    doc.address = {
      "@type": "PostalAddress",
      streetAddress: b.address.line1,
      addressLocality: b.address.city ?? undefined,
      addressRegion: b.address.region ?? undefined,
      postalCode: b.address.postalCode ?? undefined,
      addressCountry: b.address.country ?? undefined,
    };
    if (b.geo) doc.geo = { "@type": "GeoCoordinates", latitude: b.geo.lat, longitude: b.geo.lng };
  } else if (b.address?.city) {
    // Locality only: never a private street address.
    doc.address = { "@type": "PostalAddress", addressLocality: b.address.city, addressRegion: b.address.region ?? undefined, addressCountry: b.address.country ?? undefined };
  }
  if (b.serviceAreas?.length) doc.areaServed = b.serviceAreas.map((name) => ({ "@type": "Place", name }));
  if (b.hours) {
    const specs = Object.entries(b.hours).flatMap(([day, ranges]) =>
      (ranges ?? []).map((r) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: DAY_MAP[day], opens: r.open, closes: r.close })),
    );
    if (specs.length) doc.openingHoursSpecification = specs;
  }
  if (b.services?.length) {
    doc.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: "Services",
      itemListElement: b.services.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.name, ...(s.description ? { description: s.description } : {}) } })),
    };
  }
  if (b.sameAs?.length) doc.sameAs = b.sameAs;
  if (b.aggregateRating && b.aggregateRating.reviewCount > 0) {
    doc.aggregateRating = { "@type": "AggregateRating", ratingValue: b.aggregateRating.ratingValue, reviewCount: b.aggregateRating.reviewCount };
  }
  return JSON.parse(JSON.stringify(doc));
}

function isUrl(s: unknown): boolean {
  if (typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Structural and factual validation for LocalBusiness JSON-LD. */
export function validateLocalBusinessJsonLd(doc: Record<string, unknown>, facts: { name: string; phone?: string | null; hideAddress: boolean }): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (doc["@context"] !== "https://schema.org") issues.push({ code: "context", severity: "error", message: "@context must be https://schema.org" });
  if (typeof doc["@type"] !== "string") issues.push({ code: "type", severity: "error", message: "@type is required" });
  if (!doc.name) issues.push({ code: "name", severity: "error", message: "name is required" });
  else if (String(doc.name).trim() !== facts.name.trim()) issues.push({ code: "name_mismatch", severity: "error", message: "name does not match the business record" });
  for (const k of ["url", "logo"]) if (doc[k] != null && !isUrl(doc[k])) issues.push({ code: `${k}_invalid`, severity: "error", message: `${k} must be an absolute URL` });
  if (Array.isArray(doc.image) && doc.image.some((u) => !isUrl(u))) issues.push({ code: "image_invalid", severity: "error", message: "image URLs must be absolute" });
  if (doc.telephone && facts.phone && String(doc.telephone).replace(/\D/g, "").slice(-10) !== facts.phone.replace(/\D/g, "").slice(-10)) {
    issues.push({ code: "phone_mismatch", severity: "error", message: "telephone does not match the business phone" });
  }
  const addr = doc.address as Record<string, unknown> | undefined;
  if (facts.hideAddress && addr?.streetAddress) issues.push({ code: "private_address", severity: "error", message: "Service-area business address must not be published" });
  if (!doc.telephone) issues.push({ code: "telephone_missing", severity: "warning", message: "telephone is recommended" });
  if (!doc.url) issues.push({ code: "url_missing", severity: "warning", message: "url is recommended" });
  if (!doc.address && !doc.areaServed) issues.push({ code: "location_missing", severity: "warning", message: "address or areaServed is recommended" });
  const specs = doc.openingHoursSpecification as { opens?: string; closes?: string }[] | undefined;
  for (const s of specs ?? []) if (!/^\d{2}:\d{2}$/.test(s.opens ?? "") || !/^\d{2}:\d{2}$/.test(s.closes ?? "")) issues.push({ code: "hours_format", severity: "error", message: "opening hours must be HH:MM" });
  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

export function jsonLdScriptTag(doc: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify(doc).replace(/</g, "\\u003c")}</script>`;
}
