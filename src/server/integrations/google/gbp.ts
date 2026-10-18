import { httpJson } from "../http";

/**
 * Google Business Profile API client. Endpoints follow Google's published
 * APIs (Account Management v1, Business Information v1, Business Profile
 * Performance v1, and the My Business v4 endpoints that still host reviews,
 * local posts and media). Field availability varies by account, category and
 * Google's current policy, so callers must handle errors per field.
 */

const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";
const PERF = "https://businessprofileperformance.googleapis.com/v1";

export const LOCATION_READ_MASK =
  "name,title,storefrontAddress,phoneNumbers,websiteUri,categories,profile,regularHours,specialHours,serviceArea,latlng,metadata,openInfo";

export type GbpAccount = { name: string; accountName: string; type: string; role?: string };
export type GbpLocation = {
  name: string; // locations/123
  title: string;
  websiteUri?: string;
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] };
  categories?: { primaryCategory?: { name: string; displayName: string }; additionalCategories?: { name: string; displayName: string }[] };
  profile?: { description?: string };
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string; regionCode?: string };
  regularHours?: { periods?: { openDay: string; openTime: { hours?: number; minutes?: number }; closeDay: string; closeTime: { hours?: number; minutes?: number } }[] };
  serviceArea?: { businessType?: string; places?: { placeInfos?: { placeName: string; placeId: string }[] } };
  latlng?: { latitude: number; longitude: number };
  metadata?: { placeId?: string; mapsUri?: string; newReviewUri?: string; canModifyServiceList?: boolean; hasVoiceOfMerchant?: boolean };
};

export type GbpReview = {
  name: string;
  reviewId: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment: string; updateTime: string };
};

const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export const starToNumber = (s: string) => STAR[s] ?? 0;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export async function listAccounts(token: string): Promise<GbpAccount[]> {
  const res = await httpJson<{ accounts?: GbpAccount[] }>(`${ACCOUNTS}/accounts?pageSize=20`, { headers: auth(token) });
  return res.accounts ?? [];
}

export async function listLocations(token: string, accountName: string): Promise<GbpLocation[]> {
  const out: GbpLocation[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const url = `${INFO}/${accountName}/locations?pageSize=100&readMask=${LOCATION_READ_MASK}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await httpJson<{ locations?: GbpLocation[]; nextPageToken?: string }>(url, { headers: auth(token) });
    out.push(...(res.locations ?? []));
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return out;
}

export async function getLocation(token: string, locationName: string): Promise<GbpLocation> {
  return httpJson<GbpLocation>(`${INFO}/${locationName}?readMask=${LOCATION_READ_MASK}`, { headers: auth(token) });
}

/** PATCH with an explicit update mask; only masked fields change. */
export async function updateLocation(token: string, locationName: string, patch: Partial<GbpLocation>, updateMask: string[]): Promise<GbpLocation> {
  return httpJson<GbpLocation>(`${INFO}/${locationName}?updateMask=${encodeURIComponent(updateMask.join(","))}`, { method: "PATCH", headers: auth(token), body: patch });
}

export type GbpAttribute = { name: string; valueType: string; values?: unknown[] };
export type GbpAttributeMetadata = { parent: string; displayName: string; groupDisplayName?: string; valueType: string; deprecated?: boolean };

export async function getAttributes(token: string, locationName: string): Promise<GbpAttribute[]> {
  const res = await httpJson<{ attributes?: GbpAttribute[] }>(`${INFO}/${locationName}/attributes`, { headers: auth(token) });
  return res.attributes ?? [];
}

export async function listAvailableAttributes(token: string, locationName: string): Promise<GbpAttributeMetadata[]> {
  const res = await httpJson<{ attributeMetadata?: GbpAttributeMetadata[] }>(`${INFO}/attributes?parent=${locationName}&pageSize=200`, { headers: auth(token) });
  return res.attributeMetadata ?? [];
}

export async function updateAttributes(token: string, locationName: string, attrs: GbpAttribute[]) {
  const mask = attrs.map((a) => a.name.split("/").pop()).join(",");
  return httpJson(`${INFO}/${locationName}/attributes?attributeMask=${encodeURIComponent(mask)}`, {
    method: "PATCH",
    headers: auth(token),
    body: { name: `${locationName}/attributes`, attributes: attrs },
  });
}

/** v4 resources are addressed as accounts/{a}/locations/{l}. */
export function v4Location(accountName: string, locationName: string) {
  return `${accountName}/${locationName}`;
}

export async function listReviews(token: string, v4Name: string, pageToken?: string): Promise<{ reviews: GbpReview[]; nextPageToken?: string; averageRating?: number; totalReviewCount?: number }> {
  const res = await httpJson<{ reviews?: GbpReview[]; nextPageToken?: string; averageRating?: number; totalReviewCount?: number }>(
    `${V4}/${v4Name}/reviews?pageSize=50&orderBy=updateTime%20desc${pageToken ? `&pageToken=${pageToken}` : ""}`,
    { headers: auth(token) },
  );
  return { reviews: res.reviews ?? [], nextPageToken: res.nextPageToken, averageRating: res.averageRating, totalReviewCount: res.totalReviewCount };
}

export async function replyToReview(token: string, reviewName: string, comment: string) {
  return httpJson<{ comment: string; updateTime: string }>(`${V4}/${reviewName}/reply`, { method: "PUT", headers: auth(token), body: { comment } });
}

export type LocalPostInput = {
  summary: string;
  callToAction?: { actionType: string; url?: string };
  media?: { mediaFormat: "PHOTO"; sourceUrl: string }[];
  topicType?: "STANDARD";
};

export async function createLocalPost(token: string, v4Name: string, post: LocalPostInput) {
  return httpJson<{ name: string; searchUrl?: string; state?: string }>(`${V4}/${v4Name}/localPosts`, {
    method: "POST",
    headers: auth(token),
    body: { languageCode: "en-US", topicType: "STANDARD", ...post },
  });
}

export async function createMedia(token: string, v4Name: string, input: { sourceUrl: string; category: "ADDITIONAL" | "LOGO" | "COVER" | "EXTERIOR" | "INTERIOR" | "AT_WORK" | "TEAMS"; format: "PHOTO" | "VIDEO"; description?: string }) {
  return httpJson<{ name: string; googleUrl?: string }>(`${V4}/${v4Name}/media`, {
    method: "POST",
    headers: auth(token),
    body: { mediaFormat: input.format, locationAssociation: { category: input.category }, sourceUrl: input.sourceUrl, description: input.description },
  });
}

export async function listMedia(token: string, v4Name: string) {
  return httpJson<{ mediaItems?: { name: string; googleUrl?: string; thumbnailUrl?: string; mediaFormat: string; createTime?: string; description?: string; dimensions?: { widthPixels: number; heightPixels: number } }[] }>(
    `${V4}/${v4Name}/media?pageSize=100`,
    { headers: auth(token) },
  );
}

export const PERFORMANCE_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
] as const;

export async function fetchDailyMetrics(token: string, locationName: string, start: Date, end: Date) {
  const p = new URLSearchParams();
  for (const m of PERFORMANCE_METRICS) p.append("dailyMetrics", m);
  p.set("dailyRange.start_date.year", String(start.getUTCFullYear()));
  p.set("dailyRange.start_date.month", String(start.getUTCMonth() + 1));
  p.set("dailyRange.start_date.day", String(start.getUTCDate()));
  p.set("dailyRange.end_date.year", String(end.getUTCFullYear()));
  p.set("dailyRange.end_date.month", String(end.getUTCMonth() + 1));
  p.set("dailyRange.end_date.day", String(end.getUTCDate()));
  type Series = { dailyMetric: string; timeSeries?: { datedValues?: { date: { year: number; month: number; day: number }; value?: string }[] } };
  const res = await httpJson<{ multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: Series[] }[] }>(`${PERF}/${locationName}:fetchMultiDailyMetricsTimeSeries?${p}`, { headers: auth(token) });
  const out: { metric: string; date: string; value: number }[] = [];
  for (const group of res.multiDailyMetricTimeSeries ?? []) {
    for (const s of group.dailyMetricTimeSeries ?? []) {
      for (const dv of s.timeSeries?.datedValues ?? []) {
        const date = `${dv.date.year}-${String(dv.date.month).padStart(2, "0")}-${String(dv.date.day).padStart(2, "0")}`;
        out.push({ metric: s.dailyMetric, date, value: Number(dv.value ?? 0) });
      }
    }
  }
  return out;
}

export async function getUserInfo(token: string) {
  return httpJson<{ sub: string; email?: string; name?: string }>("https://openidconnect.googleapis.com/v1/userinfo", { headers: auth(token) });
}

/** Converts GBP regular hours into the internal weekly hours structure. */
export function toWeeklyHours(loc: GbpLocation) {
  const map: Record<string, string> = { MONDAY: "mon", TUESDAY: "tue", WEDNESDAY: "wed", THURSDAY: "thu", FRIDAY: "fri", SATURDAY: "sat", SUNDAY: "sun" };
  const fmt = (t: { hours?: number; minutes?: number }) => `${String(t.hours ?? 0).padStart(2, "0")}:${String(t.minutes ?? 0).padStart(2, "0")}`;
  const out: Record<string, { open: string; close: string }[]> = {};
  for (const p of loc.regularHours?.periods ?? []) {
    const k = map[p.openDay];
    if (!k) continue;
    (out[k] ??= []).push({ open: fmt(p.openTime), close: fmt(p.closeTime) });
  }
  return out;
}

export function fromWeeklyHours(hours: Record<string, { open: string; close: string }[] | undefined>) {
  const map: Record<string, string> = { mon: "MONDAY", tue: "TUESDAY", wed: "WEDNESDAY", thu: "THURSDAY", fri: "FRIDAY", sat: "SATURDAY", sun: "SUNDAY" };
  const parse = (s: string) => ({ hours: Number(s.slice(0, 2)), minutes: Number(s.slice(3, 5)) });
  const periods = Object.entries(hours).flatMap(([d, ranges]) => (ranges ?? []).map((r) => ({ openDay: map[d], openTime: parse(r.open), closeDay: map[d], closeTime: parse(r.close) })));
  return { periods };
}
