import { Card, Checkbox, Field, Flash, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { orgPage, type SP } from "@/server/page-context";
import { getPrefs, NOTIFICATION_TYPES } from "@/server/services/notifications";
import { accountAction } from "./actions";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await orgPage();
  const prefs = await getPrefs(actor.userId, actor.orgId);
  const H = () => <input type="hidden" name="_back" value="/account" />;
  return (
    <>
      <PageHeader title="Your account" description={actor.email} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <form action={accountAction} className="space-y-3">
            <H />
            <Field label="Name">
              <Input name="name" defaultValue={actor.name} required maxLength={120} />
            </Field>
            <SubmitButton name="op" value="profile" size="sm">
              Save
            </SubmitButton>
          </form>
        </Card>
        <Card title="Password">
          <form action={accountAction} className="space-y-3">
            <H />
            <Field label="Current password">
              <Input name="current" type="password" required autoComplete="current-password" />
            </Field>
            <Field label="New password" hint="At least 10 characters.">
              <Input name="next" type="password" required minLength={10} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <Input name="confirm" type="password" required minLength={10} autoComplete="new-password" />
            </Field>
            <SubmitButton name="op" value="password" size="sm">
              Change password
            </SubmitButton>
          </form>
        </Card>
        <Card title={`Notifications for ${actor.orgName}`} className="lg:col-span-2">
          <form action={accountAction} className="space-y-4">
            <H />
            <Table head={["", "In app", "Email"]}>
              {NOTIFICATION_TYPES.map((t) => (
                <tr key={t.key}>
                  <Td>{t.label}</Td>
                  <Td>
                    <Checkbox name={`app_${t.key}`} defaultChecked={prefs.channels[t.key]?.inApp ?? true} label={<span className="sr-only">In app</span>} />
                  </Td>
                  <Td>
                    <Checkbox name={`email_${t.key}`} defaultChecked={prefs.channels[t.key]?.email ?? t.defaultEmail} label={<span className="sr-only">Email</span>} />
                  </Td>
                </tr>
              ))}
            </Table>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Email timing">
                <Select name="digest" defaultValue={prefs.digest}>
                  <option value="immediate">As it happens</option>
                  <option value="daily">Daily summary</option>
                </Select>
              </Field>
              <Field label="Quiet hours from">
                <Input name="quietStart" type="time" defaultValue={prefs.quietHours?.start ?? ""} />
              </Field>
              <Field label="to">
                <Input name="quietEnd" type="time" defaultValue={prefs.quietHours?.end ?? ""} />
              </Field>
              <Field label="Time zone">
                <Input name="tz" defaultValue={prefs.quietHours?.timezone ?? ""} placeholder="America/Chicago" />
              </Field>
            </div>
            <SubmitButton name="op" value="prefs" size="sm">
              Save notification settings
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
