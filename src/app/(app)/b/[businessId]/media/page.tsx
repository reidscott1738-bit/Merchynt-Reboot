import { Alert, Badge, Card, Checkbox, EmptyState, Field, Flash, Input, PageHeader, StatusBadge, Table, Tabs, Td, Textarea, formatDate, formatDateTime } from "@/components/ui";
import { AutoSubmitSelect, CopyButton, SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { listMedia, listUploadLinks, type MediaFilters } from "@/server/services/media";
import { listIntegrations } from "@/server/services/integrations";
import { publicMediaUrl } from "@/server/storage";
import { importMediaAction, mediaAction, uploadLinkAction, uploadMediaAction } from "./actions";

export const metadata = { title: "Media" };

const SOURCE: Record<string, string> = { upload: "Uploaded", upload_link: "Upload link", gbp: "Google profile", companycam: "CompanyCam", photo_boost: "Photo Boost", ai_generated: "AI generated", render: "Rendered video", branded: "Branded image" };

export default async function MediaPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  const tab = sp.tab ?? "library";
  const base = `/b/${businessId}/media`;
  const back = `${base}?tab=${tab}${sp.kind ? `&kind=${sp.kind}` : ""}${sp.moderation ? `&moderation=${sp.moderation}` : ""}`;
  const manage = can("media.manage");
  const H = () => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={back} />
    </>
  );

  let body: React.ReactNode;
  if (tab === "links") {
    const links = await listUploadLinks(actor, businessId);
    body = (
      <div className="space-y-6">
        {sp.newLink && (
          <Alert tone="green" title="New upload link">
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="break-all text-xs">{sp.newLink}</code>
              <CopyButton value={sp.newLink} />
            </div>
          </Alert>
        )}
        <Card title="Upload links" description="Send a link to staff or customers so they can add photos without an account. Uploaders must confirm they own the photos and agree to marketing use.">
          {links.length === 0 ? (
            <p className="text-sm text-slate-500">No upload links yet.</p>
          ) : (
            <Table head={["Name", "Uploads", "Needs approval", "Expires", "Status", ""]}>
              {links.map((l) => (
                <tr key={l.id}>
                  <Td>{l.label}</Td>
                  <Td>{l.uploadsCount}</Td>
                  <Td>{l.requireApproval ? "Yes" : "No"}</Td>
                  <Td className="text-xs">{formatDate(l.expiresAt)}</Td>
                  <Td>
                    <StatusBadge status={l.revokedAt ? "revoked" : l.expiresAt < new Date() ? "expired" : "active"} />
                  </Td>
                  <Td>
                    {manage && !l.revokedAt && (
                      <form action={uploadLinkAction}>
                        <H />
                        <input type="hidden" name="id" value={l.id} />
                        <SubmitButton name="op" value="revoke" size="sm" variant="ghost">
                          Revoke
                        </SubmitButton>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {manage && (
            <form action={uploadLinkAction} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-4 md:items-end">
              <H />
              <Field label="Name">
                <Input name="label" required placeholder="Crew photos" />
              </Field>
              <Field label="Expires after (days)">
                <Input name="expiresInDays" type="number" min={1} max={365} defaultValue={30} />
              </Field>
              <Checkbox name="requireApproval" defaultChecked label="Approve uploads before use" />
              <SubmitButton name="op" value="create" size="sm">
                Create link
              </SubmitButton>
            </form>
          )}
        </Card>
      </div>
    );
  } else {
    const f: MediaFilters = { kind: (sp.kind as MediaFilters["kind"]) ?? "all", moderation: (sp.moderation as MediaFilters["moderation"]) ?? "all", q: sp.q };
    const [rows, integ] = await Promise.all([listMedia(actor, businessId, f), listIntegrations(actor)]);
    const hasCompanyCam = integ.some((i) => i.provider === "companycam" && i.status === "active");
    const pending = rows.filter((r) => r.moderationStatus === "pending").length;
    body = (
      <div className="space-y-6">
        {manage && (
          <Card title="Add photos and videos" description="JPEG, PNG, WebP, HEIC, GIF, MP4, MOV or WebM. Images up to 20 MB each; up to 100 MB per upload from the browser. Location data is read from photos only when the camera recorded it.">
            <div className="flex flex-wrap items-end gap-4">
              <form action={uploadMediaAction} className="flex flex-wrap items-end gap-2">
                <H />
                <input type="file" name="files" multiple accept="image/*,video/*,audio/*" required className="text-sm" />
                <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
              </form>
              {business.gbpLocationName && (
                <form action={importMediaAction}>
                  <H />
                  <input type="hidden" name="source" value="google" />
                  <SubmitButton variant="secondary">Import from Google</SubmitButton>
                </form>
              )}
              {hasCompanyCam && (
                <form action={importMediaAction}>
                  <H />
                  <input type="hidden" name="source" value="companycam" />
                  <input type="hidden" name="days" value="30" />
                  <SubmitButton variant="secondary">Import last 30 days from CompanyCam</SubmitButton>
                </form>
              )}
            </div>
          </Card>
        )}
        <form action={base} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="library" />
          <AutoSubmitSelect name="kind" defaultValue={f.kind} aria-label="Type">
            <option value="all">All types</option>
            <option value="image">Photos</option>
            <option value="video">Videos</option>
            <option value="audio">Audio</option>
          </AutoSubmitSelect>
          <AutoSubmitSelect name="moderation" defaultValue={f.moderation} aria-label="Approval">
            <option value="all">Any approval state</option>
            <option value="pending">Waiting for approval{pending ? ` (${pending})` : ""}</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </AutoSubmitSelect>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No media">Upload photos of your work, team and place of business.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((a) => (
              <Card key={a.id} padded={false}>
                {a.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={publicMediaUrl(a.id, "thumb")} alt={a.altText ?? ""} className="aspect-video w-full rounded-t-xl object-cover" />
                ) : a.kind === "video" ? (
                  <video src={publicMediaUrl(a.id, "original")} controls preload="none" className="aspect-video w-full rounded-t-xl bg-black" />
                ) : (
                  <audio src={publicMediaUrl(a.id, "original")} controls className="w-full p-2" />
                )}
                <div className="space-y-2 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge>{SOURCE[a.source] ?? a.source}</Badge>
                    <StatusBadge status={a.moderationStatus} />
                    {a.isAiGenerated && <Badge tone="yellow">AI generated</Badge>}
                    <span className="text-xs text-slate-500">used {a.usageCount}×</span>
                  </div>
                  <p className="truncate text-xs text-slate-500" title={a.originalFilename ?? ""}>
                    {a.originalFilename} · {Math.round(a.bytes / 1024)} KB{a.width ? ` · ${a.width}×${a.height}` : ""}
                    {a.durationMs ? ` · ${Math.round(a.durationMs / 1000)}s` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    Camera location: {a.exifLat != null ? `${a.exifLat.toFixed(5)}, ${a.exifLng?.toFixed(5)}` : "none in file"}
                    {a.exifTakenAt && ` · taken ${formatDateTime(a.exifTakenAt)}`}
                  </p>
                  {a.contributorName && (
                    <p className="text-xs text-slate-500">
                      From {a.contributorName}
                      {a.consent?.marketingUse ? " · consented to marketing use" : ""}
                    </p>
                  )}
                  {a.moderationStatus === "pending" && can("media.approve") && (
                    <form action={mediaAction} className="flex gap-2">
                      <H />
                      <input type="hidden" name="assetId" value={a.id} />
                      <SubmitButton name="op" value="approve" size="sm">
                        Approve
                      </SubmitButton>
                      <SubmitButton name="op" value="reject" size="sm" variant="secondary">
                        Reject
                      </SubmitButton>
                    </form>
                  )}
                  {manage && (
                    <details>
                      <summary className="cursor-pointer text-blue-800">Details and usage</summary>
                      <form action={mediaAction} className="mt-2 space-y-2">
                        <H />
                        <input type="hidden" name="assetId" value={a.id} />
                        <Field label="Alt text">
                          <Input name="altText" maxLength={250} defaultValue={a.altText ?? ""} />
                        </Field>
                        <Field label="Description" hint={a.descriptionSource === "ai" ? "Written by AI from the image; edit if wrong." : undefined}>
                          <Textarea name="description" rows={2} defaultValue={a.description ?? ""} />
                        </Field>
                        <Field label="SEO file name">
                          <Input name="seoFilename" defaultValue={a.seoFilename ?? ""} />
                        </Field>
                        <Field label="Associated place" hint="Where this work was done. Stored separately from camera data; never written into the file as GPS.">
                          <Input name="assocLabel" defaultValue={a.assocLabel ?? ""} placeholder="Downtown Austin" />
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Input name="assocLat" type="number" step="any" placeholder="Latitude" defaultValue={a.assocLat ?? ""} />
                          <Input name="assocLng" type="number" step="any" placeholder="Longitude" defaultValue={a.assocLng ?? ""} />
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <Checkbox name="useForPosts" defaultChecked={a.useForPosts} label="Posts" />
                          <Checkbox name="useForWebsite" defaultChecked={a.useForWebsite} label="Website" />
                          <Checkbox name="useForVideos" defaultChecked={a.useForVideos} label="Videos" />
                          <Checkbox name="useForGoogleMedia" defaultChecked={a.useForGoogleMedia} label="Google photos" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <SubmitButton name="op" value="save" size="sm" variant="secondary">
                            Save
                          </SubmitButton>
                          {a.kind === "image" && business.gbpLocationName && !a.isAiGenerated && a.moderationStatus === "approved" && a.source !== "gbp" && (
                            <SubmitButton name="op" value="google" size="sm" variant="secondary">
                              Upload to Google
                            </SubmitButton>
                          )}
                          <SubmitButton name="op" value="delete" size="sm" variant="ghost" confirm="Remove this file from the library?">
                            Remove
                          </SubmitButton>
                        </div>
                      </form>
                    </details>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Media" description="Photos and videos used for posts, videos, your website and your Google profile." />
      <Flash ok={sp.ok} err={sp.err} />
      <Tabs
        current={tab}
        items={[
          { key: "library", label: "Library", href: `${base}?tab=library` },
          { key: "links", label: "Upload links", href: `${base}?tab=links` },
        ]}
      />
      {body}
    </>
  );
}
