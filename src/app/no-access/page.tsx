import { buttonClass } from "@/components/ui";

export default function NoAccess() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">No active organization</h1>
      <p className="mt-2 text-sm text-slate-600">Your account is not an active member of any organization. Ask an owner to invite you again, or sign out and use another account.</p>
      <form action="/logout" method="post" className="mt-6">
        <button className={buttonClass("secondary")}>Sign out</button>
      </form>
    </div>
  );
}
