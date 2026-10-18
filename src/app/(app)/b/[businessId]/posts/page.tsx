import Link from "next/link";
import { Alert, Card, Checkbox, DemoBadge, EmptyState, Field, Flash, Input, PageHeader, Select, StatusBadge, Tabs, Textarea, cx, formatDateTime } from "@/components/ui";
import { CountedTextarea, SubmitButton } from "@/components/client";
import { Publications } from "@/components/publications";
import { businessPage, type SP } from "@/server/page-context";
import { listPosts, postCalendar } from "@/server/services/posts";
import { listMedia } from "@/server/services/media";
import { listTargets } from "@/server/services/integrations";
import { publicMediaUrl } from "@/server/storage";
import { dateToLocalInput } from "@/server/forms";
import { createPostAction, postAction } from "./actions";

export const metadata = { title: "Posts & Social" };

const DESTS = ["google", "facebook", "instagram", "linkedin"] as const;


export default async function PostsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  const tab = sp.tab ?? "upcoming";
  const base = `/b/${businessId}/posts`;
  const back = `${base}?tab=${tab}${sp.month ? `&month=${sp.month}` : ""}`;
  const canCreate = can("content.create");
  const [images, targets] = await Promise.all([listMedia(actor, businessId, { kind: "image", moderation: "approved", usage: "posts" }, 60), listTargets(actor, businessId)]);
  const connected = new Set<string>(targets.map((t) => t.provider as string));
  if (business.gbpLocationName) connected.add("google");
  const hidden = () => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={back} />
    </>
  );
  let body: React.ReactNode;

  if (tab === "calendar") {
    const now = new Date();
    const [y, m] = (sp.month ?? `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`).split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59));
    const items = await postCalendar(actor, businessId, new Date(start.getTime() - 86400_000), new Date(end.getTime() + 86400_000));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = start.getUTCDay();
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${m - 1}`;
    const next = m === 12 ? `${y + 1}-1` : `${y}-${m + 1}`;
    body = (
      <Card
        title={new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(start)}
        actions={
          <div className="flex gap-2 text-sm">
            <Link href={`${base}?tab=calendar&month=${prev}`} className="text-blue-700">
              ← Previous
            </Link>
            <Link href={`${base}?tab=calendar&month=${next}`} className="text-blue-700">
              Next →
            </Link>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-xs">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="bg-slate-50 px-2 py-1 font-medium text-slate-500">
              {d}
            </div>
          ))}
          {Array.from({ length: lead }).map((_, i) => (
            <div key={`l${i}`} className="min-h-24 bg-white" />
          ))}
          {Array.from({ length: days }).map((_, i) => {
            const key = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
            const dayItems = items.filter((x) => x.localDay === key);
            return (
              <div key={key} className="min-h-24 bg-white p-1.5">
                <div className="text-slate-400">{i + 1}</div>
                {dayItems.map((x) => (
                  <Link key={x.id} href={`${base}?tab=all#post-${x.id}`} className={cx("mt-1 block truncate rounded px-1 py-0.5", x.status === "published" ? "bg-emerald-50 text-emerald-800" : x.status === "pending_approval" ? "bg-amber-50 text-amber-800" : x.status === "failed" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-800")}>
                    {x.body.slice(0, 40)}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">Days are shown in {business.timezone}.</p>
      </Card>
    );
  } else if (tab === "new") {
    body = canCreate ? (
      <Card title="Write a post">
        <form action={createPostAction} className="space-y-4">
          {hidden()}
          <Field label="Post text" hint="Google allows 1,500 characters. Phone numbers in the text are rejected by Google; use the button instead.">
            <CountedTextarea name="body" max={1500} required />
          </Field>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Photo">
              <Select name="mediaAssetId" defaultValue="">
                <option value="">No photo</option>
                {images.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.altText || a.originalFilename || a.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Button">
              <Select name="ctaType" defaultValue="LEARN_MORE">
                {["NONE", "LEARN_MORE", "CALL", "BOOK", "ORDER", "SHOP", "SIGN_UP"].map((x) => (
                  <option key={x} value={x}>
                    {x.replace("_", " ").toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Button link" hint="Defaults to your website.">
              <Input name="ctaUrl" type="url" />
            </Field>
            <Field label={`Publish at (${business.timezone})`} hint="Leave empty to publish as soon as approved.">
              <Input name="scheduledFor" type="datetime-local" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            {DESTS.map((d) => (
              <Checkbox key={d} name="destinations" value={d} defaultChecked={d === "google"} label={<span className="capitalize">{d}{!connected.has(d) && " (not connected)"}</span>} />
            ))}
          </div>
          <Checkbox name="requestApproval" label="Send for approval instead of publishing" />
          <SubmitButton>Create post</SubmitButton>
        </form>
      </Card>
    ) : (
      <p className="text-sm text-slate-500">You can&apos;t create posts.</p>
    );
  } else {
    const status = tab === "upcoming" ? undefined : sp.status;
    let rows = await listPosts(actor, businessId, status);
    if (tab === "upcoming") rows = rows.filter((r) => ["draft", "pending_approval", "approved", "scheduled", "failed", "publishing"].includes(r.status));
    body =
      rows.length === 0 ? (
        <EmptyState title="No posts">Turn on the posting automation, generate drafts now, or write a post.</EmptyState>
      ) : (
        <div className="space-y-4">
          {rows.map((p) => {
            const editable = canCreate && ["draft", "pending_approval", "approved", "scheduled", "failed"].includes(p.status);
            const demo = Boolean((p.generation as { isDemo?: boolean } | null)?.isDemo);
            return (
              <Card key={p.id}>
                <div id={`post-${p.id}`} className="grid gap-4 md:grid-cols-[10rem_1fr]">
                  <div>
                    {p.mediaAssetId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={publicMediaUrl(p.mediaAssetId, "thumb")} alt="" className="w-full rounded-lg border border-slate-200 object-cover" />
                    ) : (
                      <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">No photo</div>
                    )}
                    {p.imageSource === "ai_generated" && <p className="mt-1 text-xs text-amber-700">AI-generated image</p>}
                  </div>
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                      <StatusBadge status={p.status} />
                      <span className="text-xs text-slate-500">{p.scheduledFor ? `Scheduled ${formatDateTime(p.scheduledFor, business.timezone)}` : p.publishedAt ? `Published ${formatDateTime(p.publishedAt, business.timezone)}` : "Not scheduled"}</span>
                      <DemoBadge show={demo} label="Demo copy" />
                      {p.holiday && <span className="text-xs text-slate-500">· {p.holiday}</span>}
                      {p.taskId && p.status === "pending_approval" && (
                        <Link href={`/tasks/${p.taskId}`} className="text-xs text-blue-700 underline">
                          Approval task
                        </Link>
                      )}
                    </div>
                    {p.approvalReason && p.status === "pending_approval" && <p className="mb-2 text-xs text-amber-700">{p.approvalReason}</p>}
                    {editable ? (
                      <form action={postAction} className="space-y-3">
                        {hidden()}
                        <input type="hidden" name="postId" value={p.id} />
                        <Textarea name="body" rows={5} defaultValue={p.body} maxLength={1500} />
                        {p.validation && p.validation.issues.length > 0 && (
                          <ul className="text-xs">
                            {p.validation.issues.map((i, n) => (
                              <li key={n} className={i.severity === "error" ? "text-red-600" : "text-amber-700"}>
                                {i.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="grid gap-3 md:grid-cols-2">
                          <Field label={`When (${business.timezone})`}>
                            <Input name="scheduledFor" type="datetime-local" defaultValue={dateToLocalInput(p.scheduledFor, business.timezone)} />
                          </Field>
                          <Field label="Photo">
                            <Select name="mediaAssetId" defaultValue={p.mediaAssetId ?? ""}>
                              <option value="">No photo</option>
                              {p.mediaAssetId && !images.some((i) => i.id === p.mediaAssetId) && <option value={p.mediaAssetId}>Current photo</option>}
                              {images.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.altText || a.originalFilename || a.id.slice(0, 8)}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                        <div className="flex flex-wrap gap-4">
                          {DESTS.map((d) => (
                            <Checkbox key={d} name="destinations" value={d} defaultChecked={p.destinations.includes(d)} label={<span className="capitalize">{d}</span>} />
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <SubmitButton name="op" value="save" size="sm" variant="secondary">
                            Save changes
                          </SubmitButton>
                          <SubmitButton name="op" value="regenerate" size="sm" variant="secondary" pendingText="Writing…">
                            Rewrite with AI
                          </SubmitButton>
                          {can("content.approve") && p.status !== "pending_approval" && (
                            <SubmitButton name="op" value="publish" size="sm" confirm="Publish this post now?">
                              Publish now
                            </SubmitButton>
                          )}
                          <SubmitButton name="op" value="cancel" size="sm" variant="ghost" confirm="Cancel this post?">
                            Cancel post
                          </SubmitButton>
                        </div>
                      </form>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm">{p.body}</p>
                    )}
                    <Publications rows={p.publications} />
                    {["failed", "partially_published"].includes(p.status) && can("content.approve") && (
                      <form action={postAction} className="mt-2">
                        {hidden()}
                        <input type="hidden" name="postId" value={p.id} />
                        <SubmitButton name="op" value="retry" size="sm" variant="secondary">
                          Retry failed destinations
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      );
  }

  return (
    <>
      <PageHeader
        title="Posts & Social"
        description="Google posts drafted from your verified facts and photos, optionally shared to connected social accounts. Each destination publishes once, even if a job is retried."
        actions={
          canCreate && (
            <form action={postAction}>
              {hidden()}
              <SubmitButton name="op" value="generate" pendingText="Drafting…">
                Draft upcoming posts
              </SubmitButton>
            </form>
          )
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      {!business.gbpLocationName && (
        <div className="mb-4">
          <Alert tone="blue">Google is not connected, so posts to Google will be blocked until you connect it{connected.size ? "" : ", and no social accounts are connected either"}.</Alert>
        </div>
      )}
      <Tabs
        current={tab}
        items={[
          { key: "upcoming", label: "Upcoming", href: `${base}?tab=upcoming` },
          { key: "all", label: "All posts", href: `${base}?tab=all` },
          { key: "calendar", label: "Calendar", href: `${base}?tab=calendar` },
          { key: "new", label: "Write a post", href: `${base}?tab=new` },
        ]}
      />
      {body}
    </>
  );
}
