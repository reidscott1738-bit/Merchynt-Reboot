import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/site/render";
import { liveData } from "@/server/services/websites";
import { loadPublishedSite } from "../../load";

export const revalidate = 300;

type P = { params: Promise<{ slug: string; path?: string[] }> };

async function resolve({ params }: P) {
  const { slug, path } = await params;
  const site = await loadPublishedSite(slug);
  if (!site) return null;
  const p = `/${(path ?? []).join("/")}`;
  const page = site.pages.find((x) => x.path === p);
  return page ? { site, page } : null;
}

export async function generateMetadata(props: P): Promise<Metadata> {
  const r = await resolve(props);
  if (!r) return {};
  const { site, page } = r;
  const index = site.site.settings.robotsAllowIndexing && !page.noindex;
  return {
    title: { absolute: page.metaTitle || `${page.title} | ${site.site.name}` },
    description: page.metaDescription ?? undefined,
    alternates: { canonical: `${site.base}${page.path === "/" ? "/" : page.path}` },
    robots: { index, follow: index },
  };
}

/** Public website. Only the published revision is served; demo reviews and unpublished posts are excluded. */
export default async function PublicSite(props: P) {
  const r = await resolve(props);
  if (!r) notFound();
  const { site, page } = r;
  const live = await liveData(site.site.businessId, site.pages, site.base);
  return <SitePage name={site.site.name} theme={site.site.theme} pages={site.pages} page={page} live={live} base={site.base} />;
}
