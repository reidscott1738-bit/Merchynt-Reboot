"use server";

import { z } from "zod";
import { formAction, optStr, str } from "@/server/actions";
import { invalid } from "@/server/errors";
import { INTEGRATION_PROVIDERS, PUBLISH_TARGET_TYPES, type IntegrationProvider } from "@/server/db/schema";
import { createConnectionInvite, linkTarget, revokeConnectionInvite, unlinkTarget, type DiscoveredTarget } from "@/server/services/integrations";

export async function integrationAction(form: FormData) {
  await formAction(form, async (actor) => {
    const businessId = str(form, "businessId");
    const base = `/b/${businessId}/integrations`;
    switch (str(form, "op")) {
      case "link": {
        const targetType = str(form, "targetType");
        if (!(PUBLISH_TARGET_TYPES as readonly string[]).includes(targetType)) throw invalid("Unknown destination type");
        await linkTarget(actor, businessId, str(form, "integrationId"), { targetType: targetType as DiscoveredTarget["targetType"], externalId: str(form, "externalId"), externalName: str(form, "externalName") });
        return { redirect: base, ok: "Linked" };
      }
      case "unlink":
        await unlinkTarget(actor, businessId, str(form, "targetId"));
        return "Unlinked";
      case "invite": {
        const provider = str(form, "provider");
        if (!(INTEGRATION_PROVIDERS as readonly string[]).includes(provider)) throw invalid("Unknown provider");
        const email = optStr(form, "recipientEmail");
        if (email && !z.email().safeParse(email).success) throw invalid("Enter a valid email address");
        const { url } = await createConnectionInvite(actor, { provider: provider as IntegrationProvider, businessId, recipientEmail: email });
        return { redirect: `${base}?inviteUrl=${encodeURIComponent(url)}`, ok: email ? `Invite emailed to ${email}` : "Invite link created" };
      }
      case "revoke-invite":
        await revokeConnectionInvite(actor, str(form, "inviteId"));
        return "Invite revoked";
      default:
        throw invalid("Unknown action");
    }
  });
}
