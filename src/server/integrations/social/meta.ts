import { httpJson } from "../http";

/** Facebook Pages and Instagram Graph API (content publishing). */
const G = "https://graph.facebook.com/v21.0";

export type FbPage = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } };

export async function exchangeLongLivedToken(appId: string, appSecret: string, shortToken: string) {
  return httpJson<{ access_token: string; expires_in?: number }>(
    `${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(shortToken)}`,
  );
}

export async function getMe(token: string) {
  return httpJson<{ id: string; name: string }>(`${G}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
}

export async function listPages(userToken: string): Promise<FbPage[]> {
  const res = await httpJson<{ data: FbPage[] }>(`${G}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${encodeURIComponent(userToken)}`);
  return res.data ?? [];
}

export async function getPageToken(userToken: string, pageId: string): Promise<string> {
  const res = await httpJson<{ access_token: string }>(`${G}/${pageId}?fields=access_token&access_token=${encodeURIComponent(userToken)}`);
  return res.access_token;
}

export async function publishFacebookPost(pageToken: string, pageId: string, p: { message: string; imageUrl?: string | null; link?: string | null }) {
  if (p.imageUrl) {
    const res = await httpJson<{ id: string; post_id?: string }>(`${G}/${pageId}/photos`, { method: "POST", body: { url: p.imageUrl, caption: p.message, access_token: pageToken } });
    return { providerId: res.post_id ?? res.id, url: `https://www.facebook.com/${res.post_id ?? res.id}` };
  }
  const res = await httpJson<{ id: string }>(`${G}/${pageId}/feed`, { method: "POST", body: { message: p.message, link: p.link ?? undefined, access_token: pageToken } });
  return { providerId: res.id, url: `https://www.facebook.com/${res.id}` };
}

export async function publishFacebookVideo(pageToken: string, pageId: string, p: { fileUrl: string; description: string; title: string }) {
  const res = await httpJson<{ id: string }>(`${G}/${pageId}/videos`, { method: "POST", body: { file_url: p.fileUrl, description: p.description, title: p.title, access_token: pageToken }, timeoutMs: 120_000 });
  return { providerId: res.id, url: `https://www.facebook.com/${pageId}/videos/${res.id}` };
}

/** Instagram requires a publicly reachable media URL and a two-step container flow. */
export async function publishInstagram(pageToken: string, igUserId: string, p: { caption: string; imageUrl?: string | null; videoUrl?: string | null }) {
  if (!p.imageUrl && !p.videoUrl) throw new Error("Instagram posts require an image or video");
  const container = await httpJson<{ id: string }>(`${G}/${igUserId}/media`, {
    method: "POST",
    body: p.videoUrl ? { media_type: "REELS", video_url: p.videoUrl, caption: p.caption, access_token: pageToken } : { image_url: p.imageUrl, caption: p.caption, access_token: pageToken },
  });
  if (p.videoUrl) {
    for (let i = 0; i < 30; i++) {
      const st = await httpJson<{ status_code: string }>(`${G}/${container.id}?fields=status_code&access_token=${encodeURIComponent(pageToken)}`);
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR") throw new Error("Instagram could not process the video");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  const res = await httpJson<{ id: string }>(`${G}/${igUserId}/media_publish`, { method: "POST", body: { creation_id: container.id, access_token: pageToken } });
  const perm = await httpJson<{ permalink?: string }>(`${G}/${res.id}?fields=permalink&access_token=${encodeURIComponent(pageToken)}`).catch(() => ({ permalink: undefined }));
  return { providerId: res.id, url: perm.permalink ?? null };
}
