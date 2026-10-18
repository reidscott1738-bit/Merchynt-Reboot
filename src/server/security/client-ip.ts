import { headers } from "next/headers";

/** First hop from X-Forwarded-For. Only trustworthy behind a proxy that sets it; used for rate limiting, not authorization. */
export async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
