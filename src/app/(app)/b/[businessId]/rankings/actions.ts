"use server";

import { bool, formAction, num, optStr, str } from "@/server/actions";
import { addKeyword, archiveKeyword, refreshDemand, saveAuditConfig, setCompetitorTracked, startAudit, suggestKeywords, updateKeyword } from "@/server/services/rankings";

const bid = (f: FormData) => str(f, "businessId");

export async function keywordAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = bid(form);
    switch (str(form, "op")) {
      case "add":
        await addKeyword(actor, businessId, { phrase: str(form, "phrase"), city: optStr(form, "city"), intent: str(form, "intent") || "discovery", priority: num(form, "priority") ?? 3, isTracked: true }, form.get("source") === "suggested" ? "suggested" : "user");
        return "Keyword added";
      case "update":
        await updateKeyword(actor, businessId, str(form, "id"), { priority: num(form, "priority") ?? 3, isTracked: bool(form, "isTracked"), intent: str(form, "intent") || "discovery" });
        return "Keyword updated";
      case "archive":
        await archiveKeyword(actor, businessId, str(form, "id"));
        return "Keyword archived";
      case "suggest": {
        const s = await suggestKeywords(actor, businessId);
        return { redirect: `/b/${businessId}/keywords?suggest=1`, ok: s.length ? `${s.length} suggestions below` : "No new suggestions. Add services or categories to get more." };
      }
      case "demand": {
        const r = await refreshDemand(actor, businessId);
        return r.note;
      }
      case "config":
        await saveAuditConfig(actor, businessId, str(form, "id"), {
          centerLat: num(form, "centerLat"),
          centerLng: num(form, "centerLng"),
          radiusKm: num(form, "radiusKm"),
          gridSize: num(form, "gridSize"),
          device: str(form, "device") || "mobile",
          language: str(form, "language") || "en",
          changeNote: optStr(form, "changeNote") ?? undefined,
        });
        return "Audit settings saved as a new version. Earlier audits keep their original settings.";
      case "audit": {
        const a = await startAudit(businessId, str(form, "id"), "manual", actor);
        return { redirect: `/b/${businessId}/rankings/${a.id}`, ok: "Audit queued. The map fills in as the worker observes each point." };
      }
    }
  });
}

export async function competitorAction(form: FormData) {
  await formAction(form, (actor) => setCompetitorTracked(actor, bid(form), str(form, "id"), str(form, "tracked") === "true"), "Competitor updated");
}
