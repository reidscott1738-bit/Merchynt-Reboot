import { Alert, Card, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { orgPage, type SP } from "@/server/page-context";
import { listClients } from "@/server/services/agency";
import { BusinessFields } from "../business-form";
import { createBusinessAction } from "../actions";
import { notFound } from "next/navigation";

export const metadata = { title: "Add business" };

export default async function NewBusiness({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor, can } = await orgPage();
  if (!can("business.create")) notFound();
  const clients = actor.orgKind === "agency" && can("clients.manage") ? await listClients(actor) : [];
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Add a business" description="Start with the basics. If you connect Google Business Profile in the next step, the rest is imported from your profile and you can review it." back={{ href: "/dashboard", label: "Businesses" }} />
      {sp.welcome && (
        <div className="mb-4">
          <Alert title="Welcome!">Your account is ready. Add the first business you want to manage.</Alert>
        </div>
      )}
      <Flash err={sp.err} />
      <Card>
        <form action={createBusinessAction} className="space-y-6">
          <input type="hidden" name="_back" value="/businesses/new" />
          <BusinessFields clients={clients.map((c) => ({ id: c.id, name: c.name }))} sections={["basics", "contact"]} />
          <SubmitButton pendingText="Creating…">Create business</SubmitButton>
        </form>
      </Card>
    </main>
  );
}
