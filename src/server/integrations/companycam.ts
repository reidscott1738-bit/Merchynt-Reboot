import { httpJson } from "./http";

const API = "https://api.companycam.com/v2";

export type CompanyCamPhoto = {
  id: string;
  project_id?: string;
  captured_at?: number;
  coordinates?: { lat: number; lon: number } | null;
  uris: { type: string; uri: string; url?: string }[];
  description?: string | null;
};

export async function getCurrentUser(token: string) {
  return httpJson<{ id: string; email_address?: string; first_name?: string; last_name?: string; company_id?: string }>(`${API}/users/current`, { headers: { authorization: `Bearer ${token}` } });
}

export async function listRecentPhotos(token: string, sinceUnix?: number, page = 1) {
  const q = new URLSearchParams({ per_page: "50", page: String(page) });
  if (sinceUnix) q.set("start_date", String(sinceUnix));
  return httpJson<CompanyCamPhoto[]>(`${API}/photos?${q}`, { headers: { authorization: `Bearer ${token}` } });
}

export function bestPhotoUri(p: CompanyCamPhoto): string | null {
  const order = ["original", "web", "large"];
  for (const t of order) {
    const u = p.uris.find((x) => x.type === t);
    if (u) return u.uri ?? u.url ?? null;
  }
  return p.uris[0]?.uri ?? null;
}
