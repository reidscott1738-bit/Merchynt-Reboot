import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, Field, Flash, Input, PageHeader, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { orgPage, type SP } from "@/server/page-context";
import { clientHealth, listClients } from "@/server/services/agency";
import { agencyAction } from "./actions";

export const metadata = { title: "Clients" };

export default async function AgencyPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor, can } = await orgPage();
  if (!can("clients.manage")) notFound();
  const [clients, health] = await Promise.all([listClients(actor), clientHealth(actor)]);
  const H = () => <input type="hidden" name="_back" value="/agency" />;
  const attention = health.filter((h) => h.level !== "ok").sort((a, b) => b.signals.length - a.signals.length);
  return (
    <>
      <PageHeader title="Clients" description="Group businesses by client, limit client approvers to their own businesses, and see which accounts need attention." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card title="Needs attention" description="Signals for an account manager to follow up on. They describe what happened, not predictions." padded={false}>
            {attention.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No signals right now.</p>
            ) : (
              <Table head={["Business", "Client", "Signals"]}>
                {attention.map((h) => (
                  <tr key={h.businessId} className="align-top">
                    <Td>
                      <Link href={`/b/${h.businessId}`} className="font-medium text-blue-700 hover:underline">
                        {h.name}
                      </Link>
                      <div className="mt-1">
                        <Badge tone={h.level === "high" ? "red" : "yellow"}>{h.level === "high" ? "High" : "Some"}</Badge>
                      </div>
                    </Td>
                    <Td className="text-xs">{clients.find((c) => c.id === h.clientId)?.name ?? "—"}</Td>
                    <Td>
                      <ul className="list-disc pl-4 text-sm text-slate-700">
                        {h.signals.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          {clients.length === 0 ? (
            <EmptyState title="No clients yet">Add a client, then choose it when creating or editing a business.</EmptyState>
          ) : (
            clients.map((c) => (
              <Card key={c.id} title={<span className="flex items-center gap-2">{c.name} <StatusBadge status={c.status} /></span>} description={`${c.businesses} active business${c.businesses === 1 ? "" : "es"}`}>
                <form action={agencyAction} className="grid gap-3 md:grid-cols-2">
                  <H />
                  <input type="hidden" name="id" value={c.id} />
                  <Field label="Name">
                    <Input name="name" defaultValue={c.name} required />
                  </Field>
                  <Field label="Contact name">
                    <Input name="contactName" defaultValue={c.contactName ?? ""} />
                  </Field>
                  <Field label="Contact email">
                    <Input name="contactEmail" type="email" defaultValue={c.contactEmail ?? ""} />
                  </Field>
                  <Field label="Notes">
                    <Textarea name="notes" rows={1} defaultValue={c.notes ?? ""} />
                  </Field>
                  <div className="flex gap-2 md:col-span-2">
                    <SubmitButton name="op" value="save" size="sm" variant="secondary">
                      Save
                    </SubmitButton>
                    {c.status !== "offboarded" && (
                      <SubmitButton name="op" value="offboard" size="sm" variant="ghost" confirm={`Offboard ${c.name}? Automations pause, open tasks are cancelled and businesses are archived.`}>
                        Offboard
                      </SubmitButton>
                    )}
                  </div>
                </form>
              </Card>
            ))
          )}
        </div>
        <Card title="Add a client">
          <form action={agencyAction} className="space-y-3">
            <H />
            <Field label="Name">
              <Input name="name" required maxLength={120} />
            </Field>
            <Field label="Contact name">
              <Input name="contactName" />
            </Field>
            <Field label="Contact email">
              <Input name="contactEmail" type="email" />
            </Field>
            <SubmitButton name="op" value="save" size="sm">
              Add client
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
