import { lookup } from "node:dns/promises";
import net from "node:net";
import { AppError, TransientError } from "../errors";

/**
 * Fetches a user-supplied or provider-supplied URL without letting it reach
 * private networks (SSRF protection). Every redirect hop is re-validated.
 */

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("That is not a valid URL", "invalid");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new AppError("Only http and https URLs are allowed", "invalid");
  if (url.username || url.password) throw new AppError("URLs with credentials are not allowed", "invalid");
  if (url.port && !["80", "443", ""].includes(url.port)) throw new AppError("Only standard web ports are allowed", "invalid");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new AppError("That address is not publicly reachable", "invalid");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => {
    throw new AppError(`Could not resolve ${host}`, "invalid");
  });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new AppError("That address is not publicly reachable", "invalid");
  return url;
}

export type SafeFetchResult = { url: string; status: number; contentType: string; body: Buffer; headers: Headers };

export async function safeFetch(raw: string, opts: { maxBytes?: number; timeoutMs?: number; accept?: string; maxRedirects?: number } = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  let current = raw;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 4); hop++) {
    const url = await assertPublicUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "LocalPilotBot/1.0 (+site audit)", accept: opts.accept ?? "*/*" } });
    } catch (e) {
      clearTimeout(timer);
      throw new TransientError(`Could not fetch ${url.host}: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      current = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          clearTimeout(timer);
          throw new AppError(`Response from ${url.host} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`, "invalid");
        }
        chunks.push(value);
      }
    }
    clearTimeout(timer);
    return { url: url.toString(), status: res.status, contentType: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks), headers: res.headers };
  }
  throw new AppError("Too many redirects", "invalid");
}
