import { headers } from "next/headers";
import { cache } from "react";
import { getPublishedSite } from "@/server/services/websites";

/** "_domain" is the internal slug the proxy uses for custom-domain requests. */
export const DOMAIN_SLUG = "_domain";
export const SITE_HOST_HEADER = "x-lp-site-host";

export const loadPublishedSite = cache(async (slug: string) => {
  if (slug === DOMAIN_SLUG) {
    const host = (await headers()).get(SITE_HOST_HEADER);
    return host ? getPublishedSite({ hostname: host }) : null;
  }
  return getPublishedSite({ slug });
});
