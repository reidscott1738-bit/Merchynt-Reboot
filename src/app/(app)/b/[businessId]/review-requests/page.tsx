import Link from "next/link";
import { Alert, Card, Checkbox, EmptyState, Field, Flash, Input, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { listCampaigns, listReviewLinks, reviewLinkUrl } from "@/server/services/campaigns";
import { createCampaignAction, linkAction } from "./actions";
import { CampaignFields } from "./campaign-fields";

export const metadata = { title: "Review Requests" };

export default async function ReviewRequests({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  const [links, campaigns] = await Promise.all([listReviewLinks(actor, businessId), listCampaigns(actor, businessId)]);
  const back = `/b/${businessId}/review-requests`;
  const main = reviewLinkUrl(business.reviewSlug);
  const manage = can("campaigns.manage");
  return (
    <>
      <PageHeader title="Review Requests" description="Share review links and email customers asking for a Google review. Every customer is sent to the same Google review page; there is no filtering of unhappy customers." />
      <Flash ok={sp.ok} err={sp.err} />
      {!business.googleReviewUrl && (
        <div className="mb-4">
          <Alert tone="yellow" title="No Google review link yet">
            Add it under{" "}
            <Link href={`/b/${businessId}/profile`} className="underline">
              Business Profile
            </Link>{" "}
            so review pages and emails have somewhere to send customers.
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card title="Review links" description="Each link opens a short page that sends the customer to Google and optionally lets them share photos (Photo Boost).">
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <span className="font-medium">Main page:</span>
            <code className="break-all text-xs">{main}</code>
            <CopyButton value={main} />
          </div>
          {links.length > 0 && (
            <Table head={["Link", "URL", "Opens", "Went to Google", "Photos", ""]}>
              {links.map((l) => {
                const url = reviewLinkUrl(business.reviewSlug, l.slug);
                return (
                  <tr key={l.id}>
                    <Td>
                      <span className="font-medium">{l.label}</span>
                      <div className="text-xs text-slate-500">{[l.salesperson, l.service].filter(Boolean).join(" · ")}</div>
                    </Td>
                    <Td>
                      <CopyButton value={url} label="Copy link" />
                    </Td>
                    <Td>{l.stats.open ?? 0}</Td>
                    <Td>{l.stats.continue_to_google ?? 0}</Td>
                    <Td>{l.stats.photo_uploaded ?? 0}</Td>
                    <Td>
                      {manage && (
                        <form action={linkAction}>
                          <input type="hidden" name="businessId" value={businessId} />
                          <input type="hidden" name="_back" value={back} />
                          <input type="hidden" name="id" value={l.id} />
                          <SubmitButton name="op" value="archive" size="sm" variant="ghost">
                            Archive
                          </SubmitButton>
                        </form>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
          {manage && (
            <form action={linkAction} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-4 md:items-end">
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="_back" value={back} />
              <Field label="Link name">
                <Input name="label" required placeholder="Front desk QR code" />
              </Field>
              <Field label="Salesperson (optional)">
                <Input name="salesperson" />
              </Field>
              <Field label="Service (optional)">
                <Input name="service" />
              </Field>
              <div className="space-y-2">
                <Checkbox name="photoBoostEnabled" defaultChecked label="Offer Photo Boost" />
                <SubmitButton size="sm">Create link</SubmitButton>
              </div>
            </form>
          )}
        </Card>
        <Card title="Email campaigns" padded={false}>
          {campaigns.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No campaigns yet">Create a campaign, import customers from a CSV and start sending.</EmptyState>
            </div>
          ) : (
            <Table head={["Campaign", "Status", "Contacts", "Sent", "Clicked", "Opted out"]}>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`${back}/${c.id}`} className="font-medium text-blue-800 hover:underline">
                      {c.name}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={c.status} />
                  </Td>
                  <Td>{c.summary.total}</Td>
                  <Td>{(c.summary.by.sent ?? 0) + (c.summary.by.followed_up ?? 0) + (c.summary.by.clicked ?? 0)}</Td>
                  <Td>{c.summary.by.clicked ?? 0}</Td>
                  <Td>{c.summary.by.opted_out ?? 0}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {manage && (
          <Card title="New campaign">
            <form action={createCampaignAction} className="space-y-4">
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="_back" value={back} />
              <CampaignFields links={links.map((l) => ({ id: l.id, label: l.label }))} />
              <SubmitButton>Create campaign</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
