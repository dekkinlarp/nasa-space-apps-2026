import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { REFRESH } from "./area";

const UA = "marsmap-data-pipeline/0.1 (hackathon; polite, cached)";

let bytesDownloaded = 0;
export const downloadedBytes = (): number => bytesDownloaded;

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** fetch() with retries/backoff. 404 is not retried (thrown as HttpError). */
export async function fetchBuffer(url: string, opts: { range?: [number, number]; retries?: number; timeoutMs?: number } = {}): Promise<Buffer> {
  const retries = opts.retries ?? 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers: Record<string, string> = { "User-Agent": UA };
      if (opts.range) headers.Range = `bytes=${opts.range[0]}-${opts.range[1]}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) });
      if (res.status === 404 || res.status === 400) throw new HttpError(res.status, url);
      if (!res.ok) throw new HttpError(res.status, url);
      const buf = Buffer.from(await res.arrayBuffer());
      if (opts.range && buf.length !== opts.range[1] - opts.range[0] + 1) {
        throw new Error(`short range read ${buf.length} for ${url}`);
      }
      bytesDownloaded += buf.length;
      return buf;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && (e.status === 404 || e.status === 400)) throw e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

export async function fetchJson<T = unknown>(url: string): Promise<T> {
  return JSON.parse((await fetchBuffer(url)).toString("utf8")) as T;
}

/** Download `url` to `file` unless it exists (or --refresh). Returns the bytes. */
export async function cachedFile(url: string, file: string, force = REFRESH): Promise<Buffer> {
  if (!force && existsSync(file)) return readFileSync(file);
  const buf = await fetchBuffer(url);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + ".part", buf);
  renameSync(file + ".part", file);
  return buf;
}

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function writeAtomic(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + ".part", data);
  renameSync(file + ".part", file);
}

export function writeJson(file: string, data: unknown): void {
  writeAtomic(file, JSON.stringify(data, null, 2) + "\n");
}
