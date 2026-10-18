import { describe, expect, it } from "vitest";
import { estimatedValue, monthPeriod, previousPeriod, relativeChange, sumOrNull } from "@/lib/report-math";
import { analyzeAnswer, buildQueries, extractBusinessMentions, matchesBusiness } from "@/lib/ai-visibility";
import { parseContactsCsv } from "@/lib/csv-contacts";
import { escapeHtml, isValidEmail, normalizePhone, slugify, textSimilarity, truncate } from "@/lib/text";
import { computeNextRun, describeSchedule, validateSchedule } from "@/lib/schedule";
import { upcomingHoliday, usHolidays } from "@/lib/holidays";
import { safeRedirectPath } from "@/server/security/redirects";

describe("report math", () => {
  it("computes changes without inventing values", () => {
    expect(relativeChange(120, 100)).toBe(0.2);
    expect(relativeChange(5, 0)).toBeNull();
    expect(relativeChange(0, 0)).toBe(0);
    expect(relativeChange(null, 10)).toBeNull();
    expect(sumOrNull([null, undefined])).toBeNull();
    expect(sumOrNull([1, null, 2])).toBe(3);
  });
  it("only estimates value with an explicit assumption", () => {
    expect(estimatedValue(10, null)).toBeNull();
    expect(estimatedValue(10, 0)).toBeNull();
    expect(estimatedValue(10, 25)).toBe(250);
  });
  it("computes periods", () => {
    expect(monthPeriod(2024, 2)).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(previousPeriod("2026-09-01", "2026-09-30")).toEqual({ start: "2026-08-02", end: "2026-08-31" });
  });
});

describe("AI visibility parsing", () => {
  it("builds versioned question variations", () => {
    expect(buildQueries("plumber in austin", "Austin", 2)).toEqual(["Who is the best plumber in Austin?", "Can you recommend a good plumber near Austin?"]);
    expect(buildQueries("plumber", null)[0]).toContain("my area");
  });
  it("extracts listed businesses in order", () => {
    const a = "Here are options:\n1. **Acme Plumbing** - great reviews\n2. **Bolt Drains**: fast\n- Clear Pipes Co (family owned)";
    expect(extractBusinessMentions(a)).toEqual(["Acme Plumbing", "Bolt Drains", "Clear Pipes Co"]);
  });
  it("matches identity by distinctive tokens or domain", () => {
    expect(matchesBusiness("Acme Plumbing LLC", { name: "Acme Plumbing" }).match).toBe(true);
    expect(matchesBusiness("Bolt Plumbing", { name: "Acme Plumbing" }).match).toBe(false);
    const r = analyzeAnswer("1. **Bolt Drains**\n2. **Acme Plumbing**", [], { name: "Acme Plumbing" });
    expect(r).toMatchObject({ mentioned: true, position: 2 });
    expect(analyzeAnswer("Try Bolt Drains.", [{ url: "https://acmeplumbing.com/x" }], { name: "Acme Plumbing", domain: "acmeplumbing.com" })).toMatchObject({ mentioned: true, citedDomain: true, position: null });
    expect(analyzeAnswer("Try Bolt Drains.", [], { name: "Acme Plumbing" }).mentioned).toBe(false);
  });
});

describe("contact CSV import", () => {
  it("flags invalid, duplicate and suppressed rows", () => {
    const csv = "Name,Email Address\nAnn,ann@example.com\nBob,not-an-email\nAnn again,ANN@example.com\nCy,cy@example.com\nDee,dee@example.com";
    const r = parseContactsCsv(csv, { suppressed: new Set(["cy@example.com"]), existing: new Set(["dee@example.com"]) });
    expect(r.headerErrors).toEqual([]);
    expect(r.contacts.map((c) => c.status)).toEqual(["pending", "invalid", "duplicate", "suppressed", "duplicate"]);
    expect(r.summary).toEqual({ pending: 1, invalid: 1, duplicate: 2, suppressed: 1 });
  });
  it("requires an email column", () => {
    expect(parseContactsCsv("Name\nAnn", { suppressed: new Set(), existing: new Set() }).headerErrors[0]).toMatch(/Email/);
  });
});

describe("text helpers", () => {
  it("normalizes and escapes", () => {
    expect(slugify("Café Déjà Vu!!")).toBe("cafe-deja-vu");
    expect(normalizePhone("+1 (512) 555-0100")).toBe("5125550100");
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    expect(truncate("hello wonderful world", 12)).toBe("hello…");
    expect(textSimilarity("one two three four", "one two three four")).toBe(1);
  });
  it("only accepts same-origin redirect paths", () => {
    expect(safeRedirectPath("/b/1/integrations", "/x")).toBe("/b/1/integrations");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "/a\r\nSet-Cookie: x", "", null]) expect(safeRedirectPath(bad, "/x")).toBe("/x");
  });
});

describe("schedules", () => {
  it("validates schedules", () => {
    expect(validateSchedule({ frequency: "weekly", time: "09:00", daysOfWeek: [] })).toContain("Pick at least one day of the week");
    expect(validateSchedule({ frequency: "monthly", time: "25:00", dayOfMonth: 31 })).toHaveLength(2);
  });
  it("computes the next run in the business time zone across DST", () => {
    // 2026-03-08 is the US spring-forward date.
    const next = computeNextRun({ frequency: "daily", time: "09:00" }, "America/Chicago", new Date("2026-03-07T16:00:00Z"));
    expect(next.toISOString()).toBe("2026-03-08T14:00:00.000Z");
    const weekly = computeNextRun({ frequency: "weekly", time: "08:30", daysOfWeek: [1] }, "America/New_York", new Date("2026-10-14T12:00:00Z"));
    expect(weekly.toISOString()).toBe("2026-10-19T12:30:00.000Z");
    expect(describeSchedule({ frequency: "weekly", time: "08:30", daysOfWeek: [1, 4] })).toBe("Weekly on Mon, Thu at 08:30");
  });
  it("respects intervals", () => {
    const last = new Date("2026-10-01T14:00:00Z");
    const next = computeNextRun({ frequency: "daily", time: "09:00", interval: 3 }, "America/Chicago", new Date("2026-10-01T15:00:00Z"), last);
    expect(next.toISOString()).toBe("2026-10-04T14:00:00.000Z");
  });
});

describe("holidays", () => {
  it("computes floating holidays", () => {
    expect(usHolidays(2026).find((h) => h.name === "Thanksgiving")?.date).toBe("2026-11-26");
    expect(upcomingHoliday("2026-12-23")?.name).toBe("Christmas");
    expect(upcomingHoliday("2026-06-01")).toBeNull();
  });
});
