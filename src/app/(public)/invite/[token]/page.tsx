import Link from "next/link";
import { Field, Flash, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { lookupInvitation } from "@/server/services/agency";
import { getSession } from "@/server/auth/session";
import { ROLE_LABELS } from "@/lib/permissions";
import type { SP } from "@/server/page-context";
import { acceptInviteAction } from "../../actions";
import { brandFor, PublicFrame } from "../../brand";

export const metadata = { title: "Accept invitation", referrer: "no-referrer" };

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const sp = await searchParams;
  const r = await lookupInvitation(token);
  const brand = await brandFor(r.state === "valid" ? r.invitation.orgId : null);
  if (r.state !== "valid") {
    return (
      <PublicFrame brand={brand} title="This invitation can't be used">
        <p className="text-slate-600">{r.state === "used" ? "It was already accepted." : r.state === "expired" ? "It expired. Ask for a new one." : "It is not valid or was withdrawn."}</p>
      </PublicFrame>
    );
  }
  const s = await getSession();
  const signedInAsInvitee = s?.user.email.toLowerCase() === r.invitation.email;
  const back = `/invite/${token}`;
  return (
    <PublicFrame brand={brand} title={`Join ${r.orgName}`}>
      <Flash err={sp.err} />
      <p className="mb-4 text-slate-600">
        You were invited as {ROLE_LABELS[r.invitation.role]} with {r.invitation.email}.
      </p>
      {r.hasAccount && !signedInAsInvitee ? (
        <p className="text-sm">
          You already have an account. <Link href={`/login?next=${encodeURIComponent(back)}`} className="text-blue-700 underline">Sign in as {r.invitation.email}</Link> to accept.
        </p>
      ) : (
        <form action={acceptInviteAction} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="_back" value={back} />
          {!r.hasAccount && (
            <>
              <Field label="Your name">
                <Input name="name" required maxLength={120} autoComplete="name" />
              </Field>
              <Field label="Choose a password" hint="At least 10 characters.">
                <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
              </Field>
            </>
          )}
          <SubmitButton>Accept invitation</SubmitButton>
        </form>
      )}
    </PublicFrame>
  );
}
