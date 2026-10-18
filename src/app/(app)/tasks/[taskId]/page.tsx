import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, Field, Flash, Input, PageHeader, StatusBadge, Textarea, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { orgPage, type SP } from "@/server/page-context";
import { getTaskDetail } from "@/server/services/tasks";
import { AppError } from "@/server/errors";
import { assignTaskAction, taskAction } from "@/components/tasks/actions";

export const metadata = { title: "Task" };

export default async function TaskDetail({ params, searchParams }: { params: Promise<{ taskId: string }>; searchParams: SP }) {
  const { taskId } = await params;
  const sp = await searchParams;
  const { actor, can } = await orgPage();
  let d: Awaited<ReturnType<typeof getTaskDetail>>;
  try {
    d = await getTaskDetail(actor, taskId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { task, business, preview, events, editable, assignee } = d;
  const back = `/tasks/${task.id}`;
  const canDecide = task.status === "open" && (actor.role !== "client_approver" || task.clientCanApprove) && (can("content.approve") || can("reviews.reply") || can("media.approve"));
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title={task.title}
        back={{ href: `/b/${business.id}/tasks`, label: `${business.name} tasks` }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} /> {task.type.replace("_", " ")} · created {formatDateTime(task.createdAt)} by {task.createdBy}
            {task.dueAt && <> · due {formatDateTime(task.dueAt)}</>}
          </span>
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={preview?.title ?? "Details"}>
            {task.summary && <p className="mb-3 text-sm text-slate-600">{task.summary}</p>}
            {preview?.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.imageUrl} alt="" className="mb-4 max-h-80 rounded-lg border border-slate-200" />
            )}
            {preview?.meta && (
              <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
                {Object.entries(preview.meta).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-slate-500">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {canDecide && editable ? (
              <form action={taskAction} className="space-y-3">
                <input type="hidden" name="_back" value={back} />
                <input type="hidden" name="taskId" value={task.id} />
                <Field label="Content" hint="Edit before approving if needed. Edits are validated again before anything publishes.">
                  <Textarea name="body" rows={8} defaultValue={preview?.body ?? ""} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="action" value="approve" pendingText="Approving…">
                    Approve
                  </SubmitButton>
                  <SubmitButton name="action" value="edit" variant="secondary">
                    Save without approving
                  </SubmitButton>
                </div>
              </form>
            ) : (
              <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm">{preview?.body ?? "No preview available."}</div>
            )}
            {task.outcome && (
              <details className="mt-4 text-xs text-slate-600">
                <summary className="cursor-pointer">Outcome</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify(task.outcome, null, 2)}</pre>
              </details>
            )}
          </Card>
          {canDecide && (
            <Card title="Decide">
              <form action={taskAction} className="space-y-3">
                <input type="hidden" name="_back" value={back} />
                <input type="hidden" name="taskId" value={task.id} />
                <Field label="Note (optional)" hint="Shared with the team in the task history. Used as feedback when rejecting.">
                  <Input name="reason" maxLength={500} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {!editable && (
                    <SubmitButton name="action" value="approve">
                      Approve
                    </SubmitButton>
                  )}
                  <SubmitButton name="action" value="skip" variant="secondary">
                    Skip
                  </SubmitButton>
                  <SubmitButton name="action" value="reject" variant="danger">
                    Reject
                  </SubmitButton>
                  {task.kind === "action" && (
                    <SubmitButton name="action" value="complete" variant="secondary">
                      Mark complete
                    </SubmitButton>
                  )}
                </div>
              </form>
            </Card>
          )}
          {["rejected", "skipped", "expired"].includes(task.status) && can("content.create") && (
            <form action={taskAction}>
              <input type="hidden" name="_back" value={back} />
              <input type="hidden" name="taskId" value={task.id} />
              <SubmitButton name="action" value="reopen" variant="secondary">
                Reopen task
              </SubmitButton>
            </form>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Assignment">
            <p className="mb-3 text-sm">{assignee ? `${assignee.name} (${assignee.email})` : task.assigneeEmail ?? "Unassigned"}</p>
            {can("content.create") && task.status === "open" && (
              <form action={assignTaskAction} className="space-y-3">
                <input type="hidden" name="_back" value={back} />
                <input type="hidden" name="taskId" value={task.id} />
                <Field label="Assign to email" hint="Anyone with the email gets a single-use approval link if you notify them.">
                  <Input name="assigneeEmail" type="email" defaultValue={task.assigneeEmail ?? ""} />
                </Field>
                <input type="hidden" name="tz" value={business.timezone} />
                <Field label={`Due (${business.timezone})`}>
                  <Input name="dueAt" type="datetime-local" />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="notify" /> Email an approval link
                </label>
                <SubmitButton variant="secondary">Save assignment</SubmitButton>
              </form>
            )}
          </Card>
          <Card title="History">
            <ol className="space-y-2 text-sm">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{e.action.replaceAll("_", " ")}</span> <span className="text-slate-500">by {e.actorType === "user" ? "team member" : e.actorType === "approval_link" ? `${e.actorId} (email link)` : "system"}</span>
                  <div className="text-xs text-slate-500">{formatDateTime(e.createdAt)}</div>
                </li>
              ))}
            </ol>
          </Card>
          <p className="text-xs text-slate-500">
            <Link href={`/b/${business.id}`} className="hover:underline">
              Open {business.name}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
