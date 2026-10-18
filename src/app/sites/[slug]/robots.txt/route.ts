export const dynamic = "force-dynamic";

import { robotsTxt } from "@/server/services/websites";
import { loadPublishedSite } from "../../load";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await loadPublishedSite(slug);
  if (!site) return new Response("Not found", { status: 404 });
  return new Response(robotsTxt(site.base, site.site.settings.robotsAllowIndexing), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
