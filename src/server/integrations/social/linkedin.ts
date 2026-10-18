import { httpJson } from "../http";

const API = "https://api.linkedin.com/rest";
const headers = (token: string) => ({ authorization: `Bearer ${token}`, "LinkedIn-Version": "202409", "X-Restli-Protocol-Version": "2.0.0" });

export async function listAdminOrganizations(token: string) {
  const res = await httpJson<{ elements?: { organization: string; role: string; state: string }[] }>(`${API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, { headers: headers(token) });
  return (res.elements ?? []).map((e) => ({ urn: e.organization, id: e.organization.split(":").pop() as string }));
}

async function uploadImage(token: string, ownerUrn: string, image: Buffer, contentType: string) {
  const init = await httpJson<{ value: { uploadUrl: string; image: string } }>(`${API}/images?action=initializeUpload`, { method: "POST", headers: headers(token), body: { initializeUploadRequest: { owner: ownerUrn } } });
  const put = await fetch(init.value.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": contentType }, body: new Uint8Array(image) });
  if (!put.ok) throw new Error(`LinkedIn image upload failed: ${put.status}`);
  return init.value.image;
}

export async function publishLinkedInPost(token: string, orgUrn: string, p: { text: string; image?: { data: Buffer; contentType: string; alt?: string } | null }) {
  const imageUrn = p.image ? await uploadImage(token, orgUrn, p.image.data, p.image.contentType) : null;
  const res = await fetch(`${API}/posts`, {
    method: "POST",
    headers: { ...headers(token), "content-type": "application/json" },
    body: JSON.stringify({
      author: orgUrn,
      commentary: p.text,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      ...(imageUrn ? { content: { media: { id: imageUrn, altText: p.image?.alt ?? "" } } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const { TransientError, AppError } = await import("../../errors");
    if (res.status === 429 || res.status >= 500) throw new TransientError(`LinkedIn returned ${res.status}: ${body.slice(0, 200)}`);
    throw new AppError(`LinkedIn returned ${res.status}: ${body.slice(0, 200)}`, res.status === 401 ? "not_configured" : "external");
  }
  const id = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? "";
  return { providerId: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
}
