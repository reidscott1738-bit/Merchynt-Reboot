import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { DEFAULT_CAMPAIGN, type Campaign } from "@/server/services/campaigns";

export function CampaignFields({ c, links }: { c?: Campaign; links: { id: string; label: string }[] }) {
  const d = c ?? { ...DEFAULT_CAMPAIGN, name: "", linkId: null };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Campaign name">
        <Input name="name" required defaultValue={d.name} />
      </Field>
      <Field label="Review link" hint="Which tracked link the email points to.">
        <Select name="linkId" defaultValue={d.linkId ?? ""}>
          <option value="">Main review page</option>
          {links.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Subject" className="md:col-span-2">
        <Input name="subject" required defaultValue={d.subject} maxLength={150} />
      </Field>
      <Field label="Message" hint="Use {first_name} and {business_name}. A button to the review page, your address and an unsubscribe link are added automatically. Do not offer incentives for reviews." className="md:col-span-2">
        <Textarea name="messageTemplate" rows={6} required defaultValue={d.messageTemplate} />
      </Field>
      <Checkbox name="followUpEnabled" defaultChecked={d.followUp.enabled} label="Send a follow-up to people who haven't clicked" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Days before follow-up">
          <Input name="delayDays" type="number" min={1} max={30} defaultValue={d.followUp.delayDays} />
        </Field>
        <Field label="Max follow-ups">
          <Input name="maxFollowUps" type="number" min={0} max={3} defaultValue={d.followUp.maxFollowUps} />
        </Field>
      </div>
      <Field label="Follow-up message" className="md:col-span-2">
        <Textarea name="followUpTemplate" rows={3} defaultValue={d.followUp.messageTemplate ?? ""} />
      </Field>
      <Field label="Daily limit">
        <Input name="dailyLimit" type="number" min={1} max={500} defaultValue={d.dailyLimit} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Send from (hour)">
          <Input name="startHour" type="number" min={0} max={23} defaultValue={d.sendWindow.startHour} />
        </Field>
        <Field label="Until (hour)">
          <Input name="endHour" type="number" min={1} max={24} defaultValue={d.sendWindow.endHour} />
        </Field>
      </div>
    </div>
  );
}
