import Link from "next/link";
import { Flash } from "@/components/ui";
import type { SP } from "@/server/page-context";
import { getActor } from "@/server/auth/session";
import { brandFor, PublicFrame } from "../../brand";

export const metadata = { title: "Connection" };

export default async function ConnectDone({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const actor = await getActor();
  const brand = await brandFor(actor?.orgId);
  return (
    <PublicFrame brand={brand} title={sp.err ? "Not connected" : "Connected"}>
      <Flash ok={sp.ok} err={sp.err} />
      {!sp.ok && !sp.err && <p className="text-slate-600">You can close this page.</p>}
      {actor && (
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-blue-700 underline">
          Back to the dashboard
        </Link>
      )}
    </PublicFrame>
  );
}
