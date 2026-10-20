/**
 * Small, polite HTTP client for government sites.
 *
 * - identifies itself with a contact URL
 * - bounded concurrency and retry with jitter
 * - never follows more than a handful of redirects
 * - sends `If-None-Match`/`If-Modified-Since` when a previous ETag is known
 */

export const USER_AGENT =
  process.env.EXAM_LENS_UA ??
  'ExamLensBot/1.0 (public-interest exam eligibility mirror; +https://github.com/examlens/examlens)';

export interface FetchResult {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
  bytes: Uint8Array;
  etag: string | null;
  lastModified: string | null;
  /** `set-cookie` values joined with '; ', for WebForms postbacks. */
  cookies: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  etag?: string | null;
  lastModified?: string | null;
  headers?: Record<string, string>;
  accept?: string;
  method?: 'GET' | 'POST';
  body?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NotModifiedError extends Error {
  constructor(public url: string) {
    super(`304 Not Modified: ${url}`);
  }
}

export async function fetchResource(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const { timeoutMs = 30_000, retries = 2, etag, lastModified, headers = {}, accept, method = 'GET', body } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const h: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: accept ?? 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
        'accept-language': 'en-IN,en;q=0.9,ta;q=0.8',
        ...headers,
      };
      if (etag) h['if-none-match'] = etag;
      if (lastModified) h['if-modified-since'] = lastModified;

      const res = await fetch(url, { method, body, headers: h, redirect: 'follow', signal: controller.signal });

      if (res.status === 304) throw new NotModifiedError(url);

      // The timeout must cover the body, not just the headers: a server that
      // sends headers and then stalls would otherwise hang the job forever.
      const MAX_BYTES = 40 * 1024 * 1024;
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > MAX_BYTES) throw new Error(`document too large (${declared} bytes): ${url}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) throw new Error(`document too large (${buf.byteLength} bytes): ${url}`);
      clearTimeout(timer);
      return {
        url: res.url || url,
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get('content-type') ?? '',
        text: new TextDecoder('utf-8').decode(buf),
        bytes: buf,
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        cookies: (res.headers.getSetCookie?.() ?? [])
          .map((c) => c.split(';')[0])
          .filter(Boolean)
          .join('; '),
      };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err instanceof NotModifiedError) throw err;
      if (attempt < retries) await sleep(800 * 2 ** attempt + Math.random() * 400);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Run async tasks with a fixed concurrency ceiling. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
