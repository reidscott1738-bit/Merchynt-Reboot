import { Alert, Flash, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import "@/server/services/register";
import { inspectApprovalToken } from "@/server/services/tasks";
import type { SP } from "@/server/page-context";
import { approvalAction } from "../../actions";
import { brandFor, PublicFrame } from "../../brand";

export const metadata = { title: "Review and approve", referrer: "no-referrer" };

const STATE_TEXT: Record<string, string> = {
  invalid: "This link is not valid.",
  revoked: "This link was replaced or withdrawn.",
  used: "This link was already used.",
  expired: "This link has expired. Ask the team to send a new one.",
  resolved: "This item was already handled.",
};

/** Viewing this page never changes anything; only the buttons below act, once. */
export default async function ApprovePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const sp = await searchParams;
  const r = await inspectApprovalToken(token);
  const brand = await brandFor("task" in r && r.task ? r.task.orgId : null);
  if (r.state !== "valid") {
    return (
      <PublicFrame brand={brand} title={sp.ok ? "Done" : "Nothing to do"}>
        <Flash ok={sp.ok} err={sp.err} />
        {!sp.ok && <p className="text-slate-600">{STATE_TEXT[r.state]}</p>}
      </PublicFrame>
    );
  }
  const actions = r.token.allowedActions;
  const back = `/approve/${token}`;
  return (
    <PublicFrame brand={brand} title={r.preview.title} wide>
      <Flash ok={sp.ok} err={sp.err} />
      <form action={approvalAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="_back" value={back} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {r.preview.imageUrl && <img src={r.preview.imageUrl} alt="" className="max-h-80 rounded-lg" />}
        {r.editable ? (
          <>
            <input type="hidden" name="original" value={r.preview.body} />
            <Textarea name="body" defaultValue={r.preview.body} rows={8} aria-label="Content" />
            <p className="text-xs text-slate-500">You can edit the text before approving.</p>
          </>
        ) : (
          <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm">{r.preview.body}</p>
        )}
        {r.preview.meta && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(r.preview.meta).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {actions.includes("reject") && <Textarea name="reason" rows={2} placeholder="Reason, if rejecting (optional)" />}
        <div className="flex flex-wrap gap-2">
          {actions.includes("approve") && (
            <SubmitButton name="op" value="approve" pendingText="Approving…">
              Approve
            </SubmitButton>
          )}
          {actions.includes("reject") && (
            <SubmitButton name="op" value="reject" variant="secondary">
              Reject
            </SubmitButton>
          )}
          {actions.includes("skip") && (
            <SubmitButton name="op" value="skip" variant="ghost">
              Skip
            </SubmitButton>
          )}
        </div>
        <Alert>This link works once and expires {r.token.expiresAt.toLocaleDateString("en-US", { dateStyle: "medium" })}.</Alert>
      </form>
    </PublicFrame>
  );
}
