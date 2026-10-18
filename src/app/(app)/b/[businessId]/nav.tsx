"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Brain, CheckSquare, FileBarChart, Globe, Image as ImageIcon, KeyRound, LayoutDashboard, Map, Plug, Search, Send, Share2, Star, Store, Users, Video, Zap, Rocket } from "lucide-react";
import { cx } from "@/components/ui";

const GROUPS = [
  {
    label: "",
    items: [
      { href: "", label: "Dashboard", icon: LayoutDashboard },
      { href: "/onboarding", label: "Setup", icon: Rocket },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
      { href: "/automations", label: "Automations", icon: Zap },
    ],
  },
  {
    label: "Google profile",
    items: [
      { href: "/profile", label: "Business Profile", icon: Store },
      { href: "/reviews", label: "Reviews", icon: Star },
      { href: "/review-requests", label: "Review Requests", icon: Send },
      { href: "/posts", label: "Posts & Social", icon: Share2 },
    ],
  },
  {
    label: "Rankings",
    items: [
      { href: "/keywords", label: "Keywords", icon: KeyRound },
      { href: "/rankings", label: "Ranking Audits", icon: Map },
      { href: "/competitors", label: "Competitors", icon: Users },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/media", label: "Media", icon: ImageIcon },
      { href: "/videos", label: "Video Studio", icon: Video },
      { href: "/website", label: "Website Builder", icon: Globe },
      { href: "/seo", label: "Website & AI SEO", icon: Search },
      { href: "/ai-visibility", label: "AI Visibility", icon: Bot },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/reports", label: "Reports", icon: FileBarChart },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/train", label: "Train AI", icon: Brain },
    ],
  },
];

export function BusinessNav({ businessId, openTasks }: { businessId: string; openTasks: number }) {
  const path = usePathname();
  const base = `/b/${businessId}`;
  return (
    <nav className="space-y-4 text-sm">
      {GROUPS.map((g) => (
        <div key={g.label}>
          {g.label && <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const href = `${base}${it.href}`;
              const active = it.href === "" ? path === base : path.startsWith(href);
              const Icon = it.icon;
              return (
                <li key={it.href}>
                  <Link href={href} className={cx("flex items-center gap-2 rounded-md px-2 py-1.5", active ? "bg-blue-50 font-medium text-blue-800" : "text-slate-600 hover:bg-slate-100")}>
                    <Icon size={16} />
                    <span className="flex-1">{it.label}</span>
                    {it.href === "/tasks" && openTasks > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{openTasks}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
