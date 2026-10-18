import Link from "next/link";
import { businessPage } from "@/server/page-context";
import { accessibleBusinesses } from "@/server/authz";
import { openTaskCounts } from "@/server/services/tasks";
import { BusinessNav } from "./nav";
import { BusinessSwitcher } from "./switcher";

export default async function BusinessLayout({ children, params }: { children: React.ReactNode; params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { actor, business } = await businessPage(businessId);
  const [all, counts] = await Promise.all([accessibleBusinesses(actor), openTaskCounts(actor, businessId)]);
  return (
    <div className="flex">
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-3 py-4 md:block">
        <div className="mb-4 px-1">
          {all.length > 1 ? (
            <BusinessSwitcher current={business.id} options={all.map((b) => ({ id: b.id, name: b.name, city: b.city }))} />
          ) : (
            <p className="truncate font-semibold">{business.name}</p>
          )}
          <p className="mt-0.5 truncate text-xs text-slate-500">{[business.city, business.region].filter(Boolean).join(", ") || "No address yet"}</p>
        </div>
        <BusinessNav businessId={business.id} openTasks={Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)} />
        <p className="mt-6 px-2 text-xs">
          <Link href="/dashboard" className="text-slate-500 hover:text-slate-800">
            ← All businesses
          </Link>
        </p>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
