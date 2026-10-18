import { Alert, Flash } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { lookupConnectionInvite } from "@/server/services/integrations";
import { OAUTH_PROVIDERS } from "@/server/integrations/oauth";
import type { SP } from "@/server/page-context";
import { connectInviteAction } from "../../actions";
import { brandFor, PublicFrame } from "../../brand";

export const metadata = { title: "Connect your account", referrer: "no-referrer" };

export default async function ConnectInvite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const sp = await searchParams;
  const r = await lookupConnectionInvite(token);
  const brand = await brandFor(r.state === "valid" ? r.invite.orgId : null);
  if (r.state !== "valid") {
    return (
      <PublicFrame brand={brand} title="This link can't be used">
        <p className="text-slate-600">{r.state === "used" ? "The account was already connected with this link." : r.state === "expired" ? "The link expired. Ask for a new one." : "The link is not valid or was withdrawn."}</p>
      </PublicFrame>
    );
  }
  const cfg = OAUTH_PROVIDERS[r.invite.provider];
  return (
    <PublicFrame brand={brand} title={`Connect ${cfg.label}`}>
      <Flash err={sp.err} />
      <p className="text-slate-600">
        {brand.name} is asking for permission to manage {cfg.label}
        {r.businessName ? ` for ${r.businessName}` : ""}. You sign in with {cfg.label} directly; your password is never shared.
      </p>
      <p className="mt-3 text-sm font-medium">It will be able to:</p>
      <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
        {cfg.scopes
          .filter((s) => !["openid", "email", "profile"].includes(s))
          .map((s) => (
            <li key={s}>{s.replace("https://www.googleapis.com/auth/", "")}</li>
          ))}
      </ul>
      <Alert>You can remove this access at any time from your {cfg.label} account settings.</Alert>
      <form action={connectInviteAction} className="mt-4">
        <input type="hidden" name="token" value={token} />
        <SubmitButton>Continue to {cfg.label}</SubmitButton>
      </form>
    </PublicFrame>
  );
}
