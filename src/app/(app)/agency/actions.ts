"use server";

import { formAction, optStr, str } from "@/server/actions";
import { invalid } from "@/server/errors";
import { offboardClient, saveClient } from "@/server/services/agency";

export async function agencyAction(form: FormData) {
  await formAction(form, async (actor) => {
    switch (str(form, "op")) {
      case "save":
        await saveClient(actor, { name: str(form, "name"), contactName: optStr(form, "contactName"), contactEmail: str(form, "contactEmail"), notes: optStr(form, "notes") }, optStr(form, "id") ?? undefined);
        return "Client saved";
      case "offboard":
        await offboardClient(actor, str(form, "id"));
        return "Client offboarded. Automations were paused and businesses archived; data is kept.";
      default:
        throw invalid("Unknown action");
    }
  });
}
