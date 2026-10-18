import Link from "next/link";
import { Field, Flash, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { signupAction } from "../actions";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Create your account</h1>
      <Flash err={sp.err} />
      <form action={signupAction} className="space-y-4">
        <Field label="Your name">
          <Input name="name" autoComplete="name" required />
        </Field>
        <Field label="Work email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input name="password" type="password" minLength={10} autoComplete="new-password" required />
        </Field>
        <Field label="Organization name" hint="Your business, or your agency if you manage several businesses.">
          <Input name="orgName" required />
        </Field>
        <Field label="Account type">
          <Select name="orgKind" defaultValue="business">
            <option value="business">I manage my own business</option>
            <option value="agency">I&apos;m an agency managing clients</option>
          </Select>
        </Field>
        <SubmitButton className="w-full" pendingText="Creating…">
          Create account
        </SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-blue-700">
          Sign in
        </Link>
      </p>
    </>
  );
}
