"use server";

import { all, formAction, num, optStr, str } from "@/server/actions";
import { assertCan } from "@/server/authz";
import { invalid } from "@/server/errors";
import { ROLES, type Role } from "@/server/db/schema";
import { inviteMember, markSenderVerified, revokeInvitation, saveBranding, updateMember, updateOrg } from "@/server/services/agency";
import { disconnectIntegration, runHealthChecksForOrg } from "@/server/services/integrations";
import { grantCredits } from "@/server/services/reports";
import { addCustomDomain, removeCustomDomain, verifyCustomDomain } from "@/server/services/websites";

const role = (v: string): Role => {
  if (!(ROLES as readonly string[]).includes(v)) throw invalid("Unknown role");
  return v as Role;
};

export async function settingsAction(form: FormData) {
  await formAction(form, async (actor) => {
    switch (str(form, "op")) {
      case "org":
        await updateOrg(actor, { name: str(form, "name"), kind: str(form, "kind") === "agency" ? "agency" : "business" });
        return "Organization saved";
      case "invite": {
        const { url } = await inviteMember(actor, { email: str(form, "email"), role: role(str(form, "role")), clientIds: all(form, "clientIds") });
        return { redirect: `/settings?tab=members&inviteUrl=${encodeURIComponent(url)}`, ok: "Invitation sent" };
      }
      case "revoke-invite":
        await revokeInvitation(actor, str(form, "id"));
        return "Invitation revoked";
      case "member":
        await updateMember(actor, str(form, "id"), { role: role(str(form, "role")), clientIds: all(form, "clientIds") });
        return "Member updated";
      case "deactivate":
      case "reactivate":
        await updateMember(actor, str(form, "id"), { status: str(form, "op") === "deactivate" ? "deactivated" : "active" });
        return str(form, "op") === "deactivate" ? "Member deactivated" : "Member reactivated";
      case "branding":
        await saveBranding(actor, {
          displayName: optStr(form, "displayName"),
          logoUrl: str(form, "logoUrl"),
          primaryColor: optStr(form, "primaryColor"),
          secondaryColor: optStr(form, "secondaryColor"),
          supportEmail: str(form, "supportEmail"),
          supportUrl: str(form, "supportUrl"),
          senderName: optStr(form, "senderName"),
          senderEmail: str(form, "senderEmail"),
          reportFooter: optStr(form, "reportFooter"),
        });
        return "Branding saved";
      case "sender-verified":
        await markSenderVerified(actor);
        return "Sender marked as verified";
      case "add-domain":
        await addCustomDomain(actor, { hostname: str(form, "hostname"), purpose: "app" });
        return "Domain added. Create the DNS records below, then check DNS.";
      case "verify-domain": {
        const d = await verifyCustomDomain(actor, str(form, "id"));
        return d.status === "active" ? "Domain verified" : `Not verified yet: ${d.lastError}`;
      }
      case "remove-domain":
        await removeCustomDomain(actor, str(form, "id"));
        return "Domain removed";
      case "disconnect":
        await disconnectIntegration(actor, str(form, "id"));
        return "Disconnected. Access was revoked with the provider where it supports revocation.";
      case "health":
        assertCan(actor, "integrations.manage");
        await runHealthChecksForOrg(actor.orgId);
        return "Connections checked";
      case "credits": {
        const n = num(form, "amount");
        if (n == null) throw invalid("Enter a number of credits");
        const bal = await grantCredits(actor, n, optStr(form, "note") ?? "Manual adjustment");
        return `Balance is now ${bal}`;
      }
      default:
        throw invalid("Unknown action");
    }
  });
}
