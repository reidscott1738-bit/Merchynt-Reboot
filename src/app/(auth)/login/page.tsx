import Link from "next/link";
import { redirect } from "next/navigation";
import { Field, Flash, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { getSession } from "@/server/auth/session";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  if (await getSession()) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
      <Flash err={sp.err} ok={sp.ok} />
      <form action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        New here?{" "}
        <Link href="/signup" className="font-medium text-blue-700">
          Create an account
        </Link>
      </p>
    </>
  );
}
