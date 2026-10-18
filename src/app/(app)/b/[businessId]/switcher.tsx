"use client";

import { usePathname, useRouter } from "next/navigation";

export function BusinessSwitcher({ current, options }: { current: string; options: { id: string; name: string; city: string | null }[] }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <select
      aria-label="Business"
      value={current}
      onChange={(e) => router.push(path.replace(`/b/${current}`, `/b/${e.target.value}`))}
      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
          {o.city ? ` (${o.city})` : ""}
        </option>
      ))}
    </select>
  );
}
