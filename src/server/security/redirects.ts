/** Only same-origin relative paths are accepted as redirect targets (no //host, no backslashes). */
export function safeRedirectPath(raw: string | null | undefined, fallback: string) {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") && !/[\r\n]/.test(v) ? v : fallback;
}
