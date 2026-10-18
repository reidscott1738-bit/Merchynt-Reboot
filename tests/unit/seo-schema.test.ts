import { describe, expect, it } from "vitest";
import { analyzePage, extractPage } from "@/lib/seo-analyzer";
import { buildLocalBusinessJsonLd, jsonLdScriptTag, validateLocalBusinessJsonLd } from "@/lib/schema-org";

const html = `<!doctype html><html><head><title>Home</title></head><body><h1>Welcome</h1><p>Call us.</p><img src="a.jpg"></body></html>`;

describe("SEO analyzer", () => {
  it("extracts on-page elements", () => {
    const p = extractPage(html, "https://example.com/");
    expect(p.title).toBe("Home");
    expect(p.h1).toEqual(["Welcome"]);
    expect(p.images[0]).toMatchObject({ alt: null });
  });
  it("recommends a local title and labels the basis of each finding", () => {
    const recs = analyzePage(extractPage(html, "https://example.com/"), { name: "Acme Plumbing", primaryService: "Plumber", city: "Austin", phone: "(512) 555-0100", description: null });
    const title = recs.find((r) => r.element.toLowerCase().includes("title"));
    expect(title?.status).toBe("needs_work");
    expect(title?.recommendedValue).toMatch(/Austin/);
    for (const r of recs) expect(["detected", "recommendation", "assumption"]).toContain(r.basis);
  });
});

describe("LocalBusiness JSON-LD", () => {
  const base = { name: "Acme Plumbing", description: null, url: "https://acme.example", phone: "(512) 555-0100", email: null, logoUrl: null, primaryCategory: "Plumber", address: { line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" }, hideAddress: false, geo: null, hours: { mon: [{ open: "08:00", close: "17:00" }] }, serviceAreas: [], services: [{ name: "Drain cleaning", description: null }], aggregateRating: null };
  it("builds valid markup from facts only", () => {
    const doc = buildLocalBusinessJsonLd(base);
    expect(doc["@type"]).toBe("Plumber");
    expect(doc.aggregateRating).toBeUndefined();
    expect(validateLocalBusinessJsonLd(doc, { name: base.name, phone: base.phone, hideAddress: false }).ok).toBe(true);
  });
  it("omits the street address for hidden-address businesses", () => {
    const doc = buildLocalBusinessJsonLd({ ...base, hideAddress: true });
    expect(JSON.stringify(doc)).not.toContain("1 Main St");
  });
  it("escapes the script tag", () => {
    expect(jsonLdScriptTag({ name: "</script><script>alert(1)</script>" })).not.toContain("</script><script>");
  });
});
