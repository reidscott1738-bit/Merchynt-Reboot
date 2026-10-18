"use server";

import { z } from "zod";
import { all, formAction, list, str } from "@/server/actions";
import { invalid } from "@/server/errors";
import { requestReport, sendReportTo } from "@/server/services/reports";

const emails = (raw: string[]) => {
  const bad = raw.filter((e) => !z.email().safeParse(e).success);
  if (bad.length) throw invalid(`Not a valid email address: ${bad.join(", ")}`);
  if (raw.length > 20) throw invalid("Send to at most 20 recipients at a time");
  return raw;
};

const isoDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function reportAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = str(form, "businessId");
    switch (str(form, "op")) {
      case "request": {
        const start = isoDate(str(form, "start"));
        const end = isoDate(str(form, "end"));
        if (!start || !end) throw invalid("Choose a start and end date");
        const r = await requestReport({ businessId, period: { start, end }, type: "on_demand", include: all(form, "include"), recipients: emails(list(form, "recipients")) }, actor);
        return { redirect: `/b/${businessId}/reports/${r.id}`, ok: "Report requested. It is generated in the background." };
      }
      case "send": {
        const to = emails(list(form, "recipients"));
        if (!to.length) throw invalid("Enter at least one email address");
        await sendReportTo(actor, businessId, str(form, "reportId"), to);
        return `Sent to ${to.length} recipient${to.length === 1 ? "" : "s"}`;
      }
      default:
        throw invalid("Unknown action");
    }
  });
}
