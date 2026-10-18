export const dynamic = "force-dynamic";

import { sitemapXml } from "@/server/services/websites";
import { loadPublishedSite } from "../../load";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await loadPublishedSite(slug);
  if (!site) return new Response("Not found", { status: 404 });
  const pages = site.site.settings.robotsAllowIndexing ? site.pages : [];
  return new Response(sitemapXml(site.base, pages, site.site.publishedAt ?? new Date()), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
