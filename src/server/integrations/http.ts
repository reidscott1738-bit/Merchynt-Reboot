import { AppError, TransientError } from "../errors";

export class ProviderAuthError extends AppError {
  constructor(message: string) {
    super(message, "not_configured");
  }
}

export type HttpOptions = { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number; raw?: boolean };

/**
 * JSON fetch with timeouts and error classification:
 * 401/403 → ProviderAuthError (needs reconnect), 408/429/5xx/network → TransientError (retry),
 * other 4xx → AppError (permanent).
 */
export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    const isForm = opts.body instanceof URLSearchParams;
    res = await fetch(url, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: { ...(opts.body && !isForm && !(opts.body instanceof Uint8Array) ? { "content-type": "application/json" } : {}), ...opts.headers },
      body: opts.body == null ? undefined : isForm || opts.body instanceof Uint8Array ? (opts.body as BodyInit) : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new TransientError(`Network error calling ${new URL(url).host}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (res.ok) return data as T;
  const msg = extractMessage(data) ?? `${res.status} ${res.statusText}`;
  const host = new URL(url).host;
  if (res.status === 401 || res.status === 403) throw new ProviderAuthError(`${host} rejected the credentials (${res.status}): ${msg}`);
  if (res.status === 408 || res.status === 429 || res.status >= 500) {
    const ra = Number(res.headers.get("retry-after"));
    throw new TransientError(`${host} returned ${res.status}: ${msg}`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  throw new AppError(`${host} returned ${res.status}: ${msg}`, "external", data);
}

function extractMessage(d: unknown): string | null {
  if (!d || typeof d !== "object") return typeof d === "string" ? d.slice(0, 300) : null;
  const o = d as Record<string, unknown>;
  const e = o.error as Record<string, unknown> | string | undefined;
  if (typeof e === "string") return (o.error_description as string) ?? e;
  if (e && typeof e.message === "string") return e.message;
  if (typeof o.message === "string") return o.message;
  if (typeof o.status_message === "string") return o.status_message;
  return null;
}
