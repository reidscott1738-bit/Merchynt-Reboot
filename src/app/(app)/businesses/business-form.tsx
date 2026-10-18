import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import type { businessLocations } from "@/server/db/schema";

type B = Partial<typeof businessLocations.$inferSelect>;
const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;
const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Vancouver", "Europe/London", "Europe/Dublin", "Australia/Sydney", "UTC"];

export function BusinessFields({ b = {}, clients, sections = ["basics", "contact", "address", "hours", "brand"] }: { b?: B; clients?: { id: string; name: string }[]; sections?: ("basics" | "contact" | "address" | "hours" | "brand")[] }) {
  return (
    <div className="space-y-6">
      {sections.includes("basics") && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Business name">
            <Input name="name" defaultValue={b.name ?? ""} required minLength={2} />
          </Field>
          <Field label="Primary category" hint="Use the category exactly as it appears on Google.">
            <Input name="primaryCategory" defaultValue={b.primaryCategory ?? ""} placeholder="Plumber" />
          </Field>
          <Field label="Additional categories" hint="Comma separated, up to 9." className="md:col-span-2">
            <Input name="secondaryCategories" defaultValue={(b.secondaryCategories ?? []).join(", ")} />
          </Field>
          <Field label="Description" hint="Up to 750 characters. Google rejects URLs, phone numbers and promotional claims here." className="md:col-span-2">
            <Textarea name="description" maxLength={750} defaultValue={b.description ?? ""} />
          </Field>
          {clients && clients.length > 0 && (
            <Field label="Client">
              <Select name="clientId" defaultValue={b.clientId ?? ""}>
                <option value="">No client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}
      {sections.includes("contact") && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Website">
            <Input name="website" type="url" defaultValue={b.website ?? ""} placeholder="https://" />
          </Field>
          <Field label="Phone">
            <Input name="phone" defaultValue={b.phone ?? ""} />
          </Field>
          <Field label="Public email">
            <Input name="email" type="email" defaultValue={b.email ?? ""} />
          </Field>
          <Field label="Booking link">
            <Input name="appointmentUrl" type="url" defaultValue={b.appointmentUrl ?? ""} />
          </Field>
          <Field label="Google review link" hint="Your profile's “Ask for reviews” link. Review requests send customers here.">
            <Input name="googleReviewUrl" type="url" defaultValue={b.googleReviewUrl ?? ""} />
          </Field>
          <Field label="Average customer value" hint="Used only to label estimated lead value in reports.">
            <Input name="averageCustomerValue" type="number" min={0} step="0.01" defaultValue={b.averageCustomerValue ?? ""} />
          </Field>
        </div>
      )}
      {sections.includes("address") && (
        <div className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="_flags" value="1" />
          <Field label="Street address" className="md:col-span-2">
            <Input name="addressLine1" defaultValue={b.addressLine1 ?? ""} />
          </Field>
          <Field label="Address line 2" className="md:col-span-2">
            <Input name="addressLine2" defaultValue={b.addressLine2 ?? ""} />
          </Field>
          <Field label="City">
            <Input name="city" defaultValue={b.city ?? ""} />
          </Field>
          <Field label="State / region">
            <Input name="region" defaultValue={b.region ?? ""} />
          </Field>
          <Field label="Postal code">
            <Input name="postalCode" defaultValue={b.postalCode ?? ""} />
          </Field>
          <Field label="Country (2 letters)">
            <Input name="country" maxLength={2} defaultValue={b.country ?? "US"} />
          </Field>
          <Field label="Latitude" hint="Center point for ranking grids. Imported from Google when connected.">
            <Input name="latitude" type="number" step="any" defaultValue={b.latitude ?? ""} />
          </Field>
          <Field label="Longitude">
            <Input name="longitude" type="number" step="any" defaultValue={b.longitude ?? ""} />
          </Field>
          <Field label="Time zone">
            <Select name="timezone" defaultValue={b.timezone ?? "America/Chicago"}>
              {[...new Set([b.timezone ?? "America/Chicago", ...TIMEZONES])].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Service area" hint="Cities or regions you serve, comma separated.">
            <Input name="serviceAreaPlaces" defaultValue={(b.serviceArea?.places ?? []).join(", ")} />
          </Field>
          <div className="space-y-2 md:col-span-2">
            <Checkbox name="isServiceAreaBusiness" defaultChecked={b.isServiceAreaBusiness} label="Service-area business" hint="You travel to customers." />
            <Checkbox name="hideAddress" defaultChecked={b.hideAddress} label="Hide street address publicly" />
          </div>
        </div>
      )}
      {sections.includes("hours") && (
        <div>
          <input type="hidden" name="_hours" value="1" />
          <p className="mb-2 text-sm font-medium text-slate-700">Regular hours</p>
          <div className="space-y-2">
            {DAYS.map(([k, label]) => {
              const slot = b.hours?.[k]?.[0];
              const closed = b.hours ? Array.isArray(b.hours[k]) && b.hours[k]!.length === 0 : false;
              return (
                <div key={k} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-24">{label}</span>
                  <Input name={`open_${k}`} type="time" defaultValue={slot?.open ?? ""} className="w-32" />
                  <span>to</span>
                  <Input name={`close_${k}`} type="time" defaultValue={slot?.close ?? ""} className="w-32" />
                  <Checkbox name={`closed_${k}`} defaultChecked={closed} label="Closed" />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {sections.includes("brand") && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Brand color">
            <Input name="brandPrimaryColor" type="color" defaultValue={b.brand?.primaryColor ?? "#1d4ed8"} className="h-10 w-24 p-1" />
          </Field>
          <Field label="Brand voice" hint="A sentence about tone, e.g. “Friendly, plain-spoken, no jargon.”">
            <Input name="brandVoice" maxLength={400} defaultValue={b.brand?.voice ?? ""} />
          </Field>
        </div>
      )}
    </div>
  );
}
