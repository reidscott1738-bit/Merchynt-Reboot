import type { ReactNode } from "react";
import { getBranding } from "@/server/services/agency";
import { env } from "@/server/env";

export async function brandFor(orgId: string | null | undefined) {
  const b = orgId ? await getBranding(orgId) : null;
  return { name: b?.displayName ?? env().APP_NAME, color: b?.primaryColor ?? "#2563eb", logoUrl: b?.logoUrl ?? null, supportEmail: b?.supportEmail ?? null };
}

/** Card frame for public pages, in the agency's white-label branding when there is one. */
export function PublicFrame({ brand, title, children, wide }: { brand: { name: string; color: string; logoUrl: string | null }; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "w-full max-w-2xl" : "w-full max-w-md"}>
      <div className="mb-6 flex items-center justify-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logoUrl && <img src={brand.logoUrl} alt="" className="h-8 w-auto" />}
        <span className="text-lg font-semibold" style={{ color: brand.color }}>
          {brand.name}
        </span>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {title && <h1 className="mb-4 text-xl font-semibold">{title}</h1>}
        {children}
      </div>
    </div>
  );
}
