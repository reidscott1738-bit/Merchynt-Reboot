import { notFound } from "next/navigation";
import { Card, Field, Flash, Input, PageHeader, StatusBadge, Table, Td, Textarea, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { getCampaign, listReviewLinks } from "@/server/services/campaigns";
import { AppError } from "@/server/errors";
import { campaignAction } from "../actions";
import { CampaignFields } from "../campaign-fields";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ businessId: string; campaignId: string }>; searchParams: SP }) {
  const { businessId, campaignId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  let data: Awaited<ReturnType<typeof getCampaign>>;
  try {
    data = await getCampaign(actor, businessId, campaignId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { campaign: c, contacts, summary } = data;
  const links = await listReviewLinks(actor, businessId);
  const back = `/b/${businessId}/review-requests/${c.id}`;
  const manage = can("campaigns.manage");
  const H = () => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={back} />
      <input type="hidden" name="campaignId" value={c.id} />
    </>
  );
  return (
    <>
      <PageHeader
        title={c.name}
        back={{ href: `/b/${businessId}/review-requests`, label: "Review Requests" }}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={c.status} /> {summary.total} contacts · {summary.sendable} sendable · times in {business.timezone}
          </span>
        }
        actions={
          manage && (
            <form action={campaignAction} className="flex flex-wrap items-center gap-2">
              <H />
              {["draft", "validated"].includes(c.status) && (
                <>
                  <SubmitButton name="op" value="validate" variant="secondary">
                    Check readiness
                  </SubmitButton>
                  <input type="datetime-local" name="startAt" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="Start at" />
                  <SubmitButton name="op" value="start" confirm="Start sending review requests to the enrolled contacts?">
                    Start
                  </SubmitButton>
                </>
              )}
              {["sending", "scheduled"].includes(c.status) && (
                <>
                  <SubmitButton name="op" value="send" variant="secondary">
                    Send due now
                  </SubmitButton>
                  <SubmitButton name="op" value="pause" variant="secondary">
                    Pause
                  </SubmitButton>
                </>
              )}
              {c.status === "paused" && (
                <SubmitButton name="op" value="resume">
                  Resume
                </SubmitButton>
              )}
            </form>
          )
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Contacts" padded={false}>
            <Table head={["Name", "Email", "Status", "Sends", "Last sent", "Notes"]}>
              {contacts.map((x) => (
                <tr key={x.id}>
                  <Td>{x.name ?? "—"}</Td>
                  <Td className="text-xs">{x.email}</Td>
                  <Td>
                    <StatusBadge status={x.status} />
                  </Td>
                  <Td>{x.sends}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(x.lastSentAt, business.timezone)}</Td>
                  <Td className="text-xs text-slate-500">{x.validationErrors?.join(", ") ?? x.lastError ?? ""}</Td>
                </tr>
              ))}
            </Table>
            {contacts.length === 0 && <p className="p-5 text-sm text-slate-500">No contacts yet.</p>}
          </Card>
          {manage && !["completed", "sending"].includes(c.status) && (
            <Card title="Edit campaign">
              <form action={campaignAction} className="space-y-4">
                <H />
                <CampaignFields c={c} links={links.map((l) => ({ id: l.id, label: l.label }))} />
                <SubmitButton name="op" value="update">
                  Save
                </SubmitButton>
              </form>
            </Card>
          )}
        </div>
        {manage && c.status !== "completed" && (
          <div className="space-y-6">
            <Card title="Import contacts" description="CSV with a header row: name, email (required), phone, service, salesperson. Invalid, duplicate and unsubscribed rows are kept but never emailed.">
              <form action={campaignAction} className="space-y-3">
                <H />
                <input type="file" name="csv" accept=".csv,text/csv" className="block w-full text-sm" />
                <Textarea name="csvText" rows={4} placeholder={"name,email\nJordan Lee,jordan@example.com"} />
                <SubmitButton name="op" value="import" size="sm">
                  Import
                </SubmitButton>
              </form>
            </Card>
            <Card title="Add one contact">
              <form action={campaignAction} className="space-y-3">
                <H />
                <Field label="Name">
                  <Input name="contactName" />
                </Field>
                <Field label="Email">
                  <Input name="contactEmail" type="email" required />
                </Field>
                <SubmitButton name="op" value="add" size="sm">
                  Add
                </SubmitButton>
              </form>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
