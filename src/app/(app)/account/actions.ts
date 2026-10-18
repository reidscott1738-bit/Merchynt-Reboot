"use server";

import { bool, formAction, str } from "@/server/actions";
import { getSession } from "@/server/auth/session";
import { changePassword, updateProfileName } from "@/server/auth/store";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { invalid } from "@/server/errors";
import { getPrefs, NOTIFICATION_TYPES, savePrefs } from "@/server/services/notifications";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function accountAction(form: FormData) {
  await formAction(form, async (actor) => {
    switch (str(form, "op")) {
      case "profile":
        await updateProfileName(actor.userId, str(form, "name"));
        return "Profile saved";
      case "password": {
        await consumeRateLimit(`pw-change:${actor.userId}`, 5, 900);
        const s = await getSession();
        if (!s) throw invalid("Sign in again");
        if (str(form, "next") !== str(form, "confirm")) throw invalid("The new passwords do not match");
        await changePassword(actor.userId, s.token, str(form, "current"), str(form, "next"));
        return "Password changed. Other devices were signed out.";
      }
      case "prefs": {
        const prev = await getPrefs(actor.userId, actor.orgId);
        const qs = str(form, "quietStart");
        const qe = str(form, "quietEnd");
        if ((qs || qe) && !(HHMM.test(qs) && HHMM.test(qe))) throw invalid("Enter quiet hours as HH:MM");
        await savePrefs(actor.userId, actor.orgId, {
          channels: Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.key, { email: bool(form, `email_${t.key}`), inApp: bool(form, `app_${t.key}`) }])),
          digest: str(form, "digest") === "daily" ? "daily" : "immediate",
          quietHours: qs && qe ? { start: qs, end: qe, timezone: str(form, "tz") || prev.quietHours?.timezone || "UTC" } : undefined,
        });
        return "Notification settings saved";
      }
      default:
        throw invalid("Unknown action");
    }
  });
}
