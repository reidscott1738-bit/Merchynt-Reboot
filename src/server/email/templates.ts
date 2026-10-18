import { escapeHtml } from "@/lib/text";

export type Brand = { name: string; color: string; logoUrl?: string | null; footer?: string | null };

export function layout(brand: Brand, title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:8px">
<tr><td style="padding:20px 24px;border-bottom:3px solid ${escapeHtml(brand.color)}">${brand.logoUrl ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" height="28">` : `<strong style="font-size:16px">${escapeHtml(brand.name)}</strong>`}</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb">${escapeHtml(brand.footer ?? `Sent by ${brand.name}`)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function button(href: string, label: string, color: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${escapeHtml(color)};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px">${escapeHtml(label)}</a>`;
}

export function paragraph(text: string) {
  return `<p style="margin:0 0 14px;line-height:1.5;font-size:14px">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

export function quote(text: string) {
  return `<blockquote style="margin:0 0 16px;padding:12px 14px;background:#f9fafb;border-left:3px solid #d1d5db;font-size:14px;line-height:1.5">${escapeHtml(text).replace(/\n/g, "<br>")}</blockquote>`;
}
