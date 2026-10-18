"use server";

import { redirect } from "next/navigation";
import { switchOrg } from "@/server/auth/session";
import { formAction, str } from "@/server/actions";
import { markAllRead } from "@/server/services/notifications";

export async function switchOrgAction(form: FormData) {
  await switchOrg(str(form, "orgId"));
  redirect("/dashboard");
}

export async function markNotificationsReadAction(form: FormData) {
  await formAction(form, (a) => markAllRead(a.userId, a.orgId), "Marked all as read");
}
