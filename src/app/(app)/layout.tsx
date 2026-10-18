import Link from "next/link";
import { Bell } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { userOrgs } from "@/server/page-context";
import { unreadCount } from "@/server/services/notifications";
import { env } from "@/server/env";
import { getBranding } from "@/server/services/agency";
import { can } from "@/lib/permissions";
import { switchOrgAction } from "./actions";
import { AutoSubmitSelect } from "@/components/client";
import { aiStatus } from "@/server/ai/provider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const [orgs, unread, branding] = await Promise.all([userOrgs(actor), unreadCount(actor.userId, actor.orgId), getBranding(actor.orgId)]);
  const demo = env().DEMO_MODE;
  const ai = aiStatus();
  const brandName = branding?.displayName || env().APP_NAME;
  return (
    <div className="min-h-screen">
      {demo && (
        <div className="bg-violet-700 px-4 py-1.5 text-center text-xs font-medium text-white">
          Demo mode is on. Providers without credentials return synthetic data, and every such record is labeled “Demo data”. Nothing labeled demo was published to or fetched from a real service.
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-4">
          <Link href="/dashboard" className="font-semibold" style={{ color: branding?.primaryColor ?? "#1d4ed8" }}>
            {brandName}
          </Link>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <Link className="rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-slate-100" href="/dashboard">
              Businesses
            </Link>
            <Link className="rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-slate-100" href="/tasks">
              Tasks
            </Link>
            {can(actor.role, "clients.manage") && actor.orgKind === "agency" && (
              <Link className="rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-slate-100" href="/agency">
                Clients
              </Link>
            )}
            {can(actor.role, "members.manage") && (
              <Link className="rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-slate-100" href="/settings">
                Settings
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {!ai.configured && <span className="hidden text-xs text-amber-700 lg:inline">AI is not configured</span>}
            {orgs.length > 1 && (
              <form action={switchOrgAction}>
                <AutoSubmitSelect name="orgId" defaultValue={actor.orgId} aria-label="Organization">
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </AutoSubmitSelect>
              </form>
            )}
            {orgs.length <= 1 && <span className="hidden text-sm text-slate-500 sm:inline">{actor.orgName}</span>}
            <Link href="/notifications" className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
              <Bell size={18} />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <Link href="/account" className="text-sm text-slate-700 hover:underline">
              {actor.name}
            </Link>
            <form action="/logout" method="post">
              <button className="text-sm text-slate-500 hover:text-slate-800">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
