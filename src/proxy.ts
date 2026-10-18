import { NextResponse, type NextRequest } from "next/server";

const SITE_HOST_HEADER = "x-lp-site-host";

/** APP_URL's host plus any verified white-label app domains listed in APP_HOSTS (comma separated). */
function appHosts() {
  const hosts = (process.env.APP_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  try {
    hosts.push(new URL(process.env.APP_URL ?? "http://localhost:3000").host.toLowerCase());
  } catch {
    hosts.push("localhost:3000");
  }
  return hosts;
}

/**
 * Requests on a host other than the app's are treated as a custom website
 * domain and rewritten to the published site. The site-host header is set
 * only here; any client-supplied copy is removed.
 */
export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const headers = new Headers(req.headers);
  headers.delete(SITE_HOST_HEADER);
  const isApp = appHosts().includes(host) || host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const { pathname } = req.nextUrl;
  if (isApp || pathname.startsWith("/api/public/") || pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next({ request: { headers } });
  }
  headers.set(SITE_HOST_HEADER, host.replace(/:\d+$/, ""));
  const url = req.nextUrl.clone();
  url.pathname = `/sites/_domain${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
