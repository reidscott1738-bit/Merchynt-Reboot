import Link from "next/link";
import { Alert, Badge, Card, Checkbox, EmptyState, Field, Flash, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Textarea, cx, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { domainInstructions, getWebsiteForBusiness, SECTION_TYPES, siteUrl } from "@/server/services/websites";
import { listMedia } from "@/server/services/media";
import { websiteAction } from "./actions";

export const metadata = { title: "Website Builder" };

export default async function WebsitePage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, can } = await businessPage(businessId);
  const data = await getWebsiteForBusiness(actor, businessId);
  const edit = can("website.edit");
  const base = `/b/${businessId}/website`;

  if (!data) {
    return (
      <>
        <PageHeader title="Website Builder" description="Generate a fast, mobile-friendly website from your verified business facts, services and photos." />
        <Flash ok={sp.ok} err={sp.err} />
        <EmptyState
          title="No website yet"
          action={
            edit && (
              <form action={websiteAction}>
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="_back" value={base} />
                <SubmitButton name="op" value="generate" pendingText="Writing pages…">
                  Generate website
                </SubmitButton>
              </form>
            )
          }
        >
          Pages are drafted for home, services, each service, service areas, about, reviews, FAQs, contact and privacy. Nothing is public until you publish.
        </EmptyState>
      </>
    );
  }

  const { site, pages, revisions, deployments, domains } = data;
  const page = pages.find((p) => p.id === sp.page) ?? pages[0];
  const back = `${base}?page=${page?.id ?? ""}`;
  const images = await listMedia(actor, businessId, { kind: "image", moderation: "approved", usage: "website" }, 60);
  const lastDeploy = deployments[0];
  const activeDomain = domains.find((d) => d.status === "active");
  const H = ({ sectionId }: { sectionId?: string }) => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={back} />
      {page && <input type="hidden" name="pageId" value={page.id} />}
      {sectionId && <input type="hidden" name="sectionId" value={sectionId} />}
    </>
  );

  return (
    <>
      <PageHeader
        title="Website Builder"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={site.status} />
            {site.publishedAt && <>Last published {formatDateTime(site.publishedAt)} ·</>}
            {site.publishedRevisionId ? (
              <a href={siteUrl(site, activeDomain?.hostname)} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                {siteUrl(site, activeDomain?.hostname)}
              </a>
            ) : (
              "Not published"
            )}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/preview/${businessId}${page?.path === "/" ? "" : (page?.path ?? "")}`} variant="secondary" target="_blank">
              Preview draft
            </LinkButton>
            {can("website.publish") && (
              <form action={websiteAction} className="flex gap-2">
                <H />
                {site.publishedRevisionId && (
                  <SubmitButton name="op" value="unpublish" variant="ghost" confirm="Take the website offline?">
                    Unpublish
                  </SubmitButton>
                )}
                <SubmitButton name="op" value="publish" pendingText="Checking…">
                  Publish
                </SubmitButton>
              </form>
            )}
          </>
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      {site.generationError && (
        <div className="mb-4">
          <Alert tone="red" title="Generation failed">{site.generationError}</Alert>
        </div>
      )}
      {lastDeploy?.checks && lastDeploy.checks.length > 0 && (
        <div className="mb-4">
          <Alert tone={lastDeploy.status === "failed_validation" ? "red" : "yellow"} title={lastDeploy.status === "failed_validation" ? "Last publish was blocked" : "Checks from the last publish"}>
            <ul className="mt-1 list-disc pl-5">
              {lastDeploy.checks.flatMap((c) =>
                c.issues.map((i, n) => (
                  <li key={`${c.page}${n}`}>
                    {c.page}: {i.message} {i.severity === "error" && <Badge tone="red">blocks publishing</Badge>}
                  </li>
                )),
              )}
            </ul>
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <aside className="space-y-4">
          <nav className="space-y-0.5 text-sm">
            {pages.map((p) => (
              <Link key={p.id} href={`${base}?page=${p.id}`} className={cx("block truncate rounded-md px-2 py-1.5", p.id === page?.id ? "bg-blue-50 font-medium text-blue-800" : "text-slate-600 hover:bg-slate-100")}>
                {p.navLabel} <span className="text-xs text-slate-400">{p.path}</span>
              </Link>
            ))}
          </nav>
          {edit && (
            <form action={websiteAction} className="space-y-2 border-t border-slate-200 pt-3">
              <H />
              <Input name="title" placeholder="New page title" required />
              <SubmitButton name="op" value="add-page" size="sm" variant="secondary">
                Add page
              </SubmitButton>
            </form>
          )}
        </aside>
        <div className="min-w-0 space-y-6">
          {page && (
            <>
              <Card title={`${page.title}`} description={`Address: ${page.path}`}>
                <form action={websiteAction} className="grid gap-3 md:grid-cols-2">
                  <H />
                  <Field label="Page title">
                    <Input name="title" defaultValue={page.title} disabled={!edit} />
                  </Field>
                  <Field label="Menu label">
                    <Input name="navLabel" defaultValue={page.navLabel} disabled={!edit} />
                  </Field>
                  <Field label="Meta title" hint="About 60 characters.">
                    <Input name="metaTitle" defaultValue={page.metaTitle ?? ""} maxLength={120} disabled={!edit} />
                  </Field>
                  {page.type !== "home" && (
                    <Field label="Address">
                      <Input name="path" defaultValue={page.path} disabled={!edit} />
                    </Field>
                  )}
                  <Field label="Meta description" hint="About 155 characters." className="md:col-span-2">
                    <Textarea name="metaDescription" rows={2} defaultValue={page.metaDescription ?? ""} maxLength={320} disabled={!edit} />
                  </Field>
                  <Checkbox name="noindex" defaultChecked={page.noindex} label="Hide from search engines" disabled={!edit} />
                  {edit && (
                    <div className="flex gap-2 md:col-span-2">
                      <SubmitButton name="op" value="page-meta" size="sm" variant="secondary">
                        Save page settings
                      </SubmitButton>
                      {page.type !== "home" && (
                        <SubmitButton name="op" value="delete-page" size="sm" variant="ghost" confirm="Delete this page from the draft?">
                          Delete page
                        </SubmitButton>
                      )}
                    </div>
                  )}
                </form>
              </Card>
              {page.sections.map((s, i) => {
                const meta = SECTION_TYPES[s.type];
                const d = s.data as Record<string, unknown>;
                const manual = s.manualFields ?? [];
                return (
                  <Card
                    key={s.id}
                    title={
                      <span className="flex items-center gap-2">
                        {meta?.label ?? s.type} {manual.length > 0 && <Badge tone="blue">Edited: {manual.join(", ")}</Badge>}
                      </span>
                    }
                    description={meta?.live ? `Live content: ${meta.live}` : undefined}
                  >
                    <form action={websiteAction} className="space-y-3">
                      <H sectionId={s.id} />
                      <Field label="Heading">
                        <Input name="heading" defaultValue={String(d.heading ?? "")} disabled={!edit} />
                      </Field>
                      {meta?.copyFields.includes("body") && (
                        <Field label="Text">
                          <Textarea name="body" rows={5} defaultValue={String(d.body ?? "")} disabled={!edit} />
                        </Field>
                      )}
                      {["hero", "cta"].includes(s.type) && (
                        <Field label="Button label">
                          <Input name="ctaLabel" defaultValue={String(d.ctaLabel ?? "")} disabled={!edit} />
                        </Field>
                      )}
                      {["text", "service_detail"].includes(s.type) && (
                        <Field label="Image">
                          <Select name="imageAssetId" defaultValue={String(d.imageAssetId ?? "")} disabled={!edit}>
                            <option value="">No image</option>
                            {images.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.altText || a.originalFilename || a.id.slice(0, 8)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                      {edit && (
                        <div className="flex flex-wrap items-center gap-2">
                          <SubmitButton name="op" value="section" size="sm" variant="secondary">
                            Save
                          </SubmitButton>
                          <SubmitButton name="op" value="up" size="sm" variant="ghost" disabled={i === 0}>
                            Up
                          </SubmitButton>
                          <SubmitButton name="op" value="down" size="sm" variant="ghost" disabled={i === page.sections.length - 1}>
                            Down
                          </SubmitButton>
                          <SubmitButton name="op" value="remove-section" size="sm" variant="ghost" confirm="Remove this section?">
                            Remove
                          </SubmitButton>
                        </div>
                      )}
                    </form>
                    {edit && (meta?.copyFields.length ?? 0) > 0 && (
                      <form action={websiteAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                        <H sectionId={s.id} />
                        <Field label="Regenerate with an instruction (optional)" className="min-w-64 flex-1">
                          <Input name="instruction" maxLength={300} placeholder="Shorter, mention same-day service" />
                        </Field>
                        <Checkbox name="overwriteManual" label="Replace my edits too" />
                        <SubmitButton name="op" value="regenerate" size="sm" variant="secondary" pendingText="Writing…">
                          Regenerate
                        </SubmitButton>
                      </form>
                    )}
                  </Card>
                );
              })}
              {edit && (
                <form action={websiteAction} className="flex items-end gap-2">
                  <H />
                  <Field label="Add a section">
                    <Select name="type">
                      {Object.entries(SECTION_TYPES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <SubmitButton name="op" value="add-section" size="sm" variant="secondary">
                    Add
                  </SubmitButton>
                </form>
              )}
            </>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Site settings">
              <form action={websiteAction} className="space-y-3">
                <H />
                <Field label="Site name">
                  <Input name="name" defaultValue={site.name} disabled={!edit} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Main color">
                    <Input name="primaryColor" type="color" defaultValue={site.theme.primaryColor} className="h-10 p-1" disabled={!edit} />
                  </Field>
                  <Field label="Accent color">
                    <Input name="accentColor" type="color" defaultValue={site.theme.accentColor} className="h-10 p-1" disabled={!edit} />
                  </Field>
                </div>
                <Checkbox name="robotsAllowIndexing" defaultChecked={site.settings.robotsAllowIndexing} label="Allow search engines to index the site" disabled={!edit} />
                {edit && (
                  <SubmitButton name="op" value="settings" size="sm" variant="secondary">
                    Save settings
                  </SubmitButton>
                )}
              </form>
            </Card>
            <Card title="Versions" description="Restoring a version replaces the draft; the live site changes when you publish.">
              {edit && (
                <form action={websiteAction} className="mb-3 flex gap-2">
                  <H />
                  <Input name="note" placeholder="Version note" />
                  <SubmitButton name="op" value="save-version" size="sm" variant="secondary">
                    Save
                  </SubmitButton>
                </form>
              )}
              <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
                {revisions.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      v{r.number} · {r.note} <span className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</span> {r.id === site.publishedRevisionId && <Badge tone="green">live</Badge>}
                    </span>
                    {edit && (
                      <form action={websiteAction}>
                        <H />
                        <input type="hidden" name="revisionId" value={r.id} />
                        <SubmitButton name="op" value="restore" size="sm" variant="ghost" confirm={`Restore version ${r.number} into the draft?`}>
                          Restore
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="Custom domain" description="Point your own domain at the site. TLS and routing for custom domains are handled by your deployment's reverse proxy.">
            {domains.length > 0 && (
              <div className="mb-4 space-y-4">
                {domains.map((d) => (
                  <div key={d.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{d.hostname}</span> <StatusBadge status={d.status} />
                      {d.lastError && <span className="text-xs text-red-600">{d.lastError}</span>}
                    </div>
                    {d.status !== "active" && (
                      <Table head={["Type", "Name", "Value"]}>
                        {domainInstructions(d).map((r) => (
                          <tr key={r.type}>
                            <Td>{r.type}</Td>
                            <Td className="break-all font-mono text-xs">{r.name}</Td>
                            <Td className="break-all font-mono text-xs">{r.value}</Td>
                          </tr>
                        ))}
                      </Table>
                    )}
                    {can("website.publish") && (
                      <form action={websiteAction} className="mt-2 flex gap-2">
                        <H />
                        <input type="hidden" name="domainId" value={d.id} />
                        <SubmitButton name="op" value="verify-domain" size="sm" variant="secondary">
                          Check DNS
                        </SubmitButton>
                        <SubmitButton name="op" value="remove-domain" size="sm" variant="ghost" confirm="Disconnect this domain?">
                          Remove
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
            {can("website.publish") && (
              <form action={websiteAction} className="flex gap-2">
                <H />
                <Input name="hostname" placeholder="www.example.com" required />
                <SubmitButton name="op" value="add-domain" size="sm" variant="secondary">
                  Add domain
                </SubmitButton>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
