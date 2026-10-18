import { SubmitButton } from "@/components/client";
import type { SP } from "@/server/page-context";
import { unsubscribeAction } from "../../actions";
import { PublicFrame, brandFor } from "../../brand";

export const metadata = { title: "Unsubscribe", referrer: "no-referrer" };

/** Opening the link does nothing by itself (mail scanners follow links); the button unsubscribes. */
export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const sp = await searchParams;
  const brand = await brandFor(null);
  if (sp.ok) {
    return (
      <PublicFrame brand={brand} title="You are unsubscribed">
        <p className="text-slate-600">{sp.ok}</p>
      </PublicFrame>
    );
  }
  return (
    <PublicFrame brand={brand} title="Stop review request emails?">
      {sp.err && <p className="mb-3 text-sm text-red-600">{sp.err}</p>}
      <form action={unsubscribeAction}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="_back" value={`/u/${token}`} />
        <SubmitButton>Unsubscribe</SubmitButton>
      </form>
    </PublicFrame>
  );
}
