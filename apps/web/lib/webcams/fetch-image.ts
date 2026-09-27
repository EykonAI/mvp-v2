import { createHash } from 'node:crypto';
import { resolveSgImage, SG_API } from './providers';

/**
 * Fetch one camera's current image from its upstream (IMG-5).
 *
 * Used by BOTH the liveness cron and the public image proxy, so what the
 * proxy serves is exactly what liveness checked:
 *   · the upstream URL never leaves the server;
 *   · the body must BE an image — checked by its magic bytes (JPEG/PNG), not
 *     the declared type (data.gov.sg serves JPEGs as application/octet-stream);
 *   · Last-Modified older than STALE_HOURS means the camera is not updating:
 *     outcome 'frozen', even on its first check (a USGS camera's newest image
 *     was from March 2025 on 2026-09-26).
 */

export const STALE_HOURS = 24;

/**
 * Known "camera unavailable" images, by SHA-256. A placeholder is served
 * with HTTP 200 and a valid PNG, so the magic-byte check passes it; it is
 * not a camera frame, so it is a decode_error. Read live 2026-09-27:
 *   511NY /map/Cctv/<n> for a Disabled camera — 15,136-byte PNG, no Last-Modified.
 */
export const PLACEHOLDER_SHA256 = new Set<string>([
  'e608c39b77e5480ce13682b571638e4246ff519dd6c79402c393db5e273aab19',
]);
const MAX_BYTES = 5 * 1024 * 1024;
const UA = { 'User-Agent': 'eYKON-webcams/1 (+https://eykon.ai)' };

export type FetchOutcome = 'ok' | 'frozen' | 'http_error' | 'timeout' | 'decode_error';

export interface FetchedImage {
  outcome: FetchOutcome;
  httpStatus: number | null;
  bytes: Buffer | null;
  contentType: 'image/jpeg' | 'image/png' | null;
  sha256: string | null;
  lastModified: string | null;
}

function sniff(b: Buffer): FetchedImage['contentType'] {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return null;
}

export async function fetchCameraImage(upstreamUrl: string, now = Date.now()): Promise<FetchedImage> {
  const empty = { bytes: null, contentType: null, sha256: null, lastModified: null } as const;
  let url: string | null = upstreamUrl;
  try {
    if (upstreamUrl.startsWith(SG_API)) url = await resolveSgImage(upstreamUrl);
    if (!url) return { outcome: 'http_error', httpStatus: 404, ...empty };
    const res = await fetch(url, { headers: UA, cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { outcome: 'http_error', httpStatus: res.status, ...empty };
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_BYTES) return { outcome: 'decode_error', httpStatus: res.status, ...empty };
    const bytes = Buffer.from(await res.arrayBuffer());
    const contentType = bytes.length <= MAX_BYTES ? sniff(bytes) : null;
    if (!contentType) return { outcome: 'decode_error', httpStatus: res.status, ...empty };
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (PLACEHOLDER_SHA256.has(sha256)) return { outcome: 'decode_error', httpStatus: res.status, ...empty };
    const lastModified = res.headers.get('last-modified');
    const lm = lastModified ? Date.parse(lastModified) : NaN;
    const stale = Number.isFinite(lm) && now - lm > STALE_HOURS * 3600_000;
    return {
      outcome: stale ? 'frozen' : 'ok',
      httpStatus: res.status,
      bytes,
      contentType,
      sha256,
      lastModified,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    return { outcome: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'http_error', httpStatus: null, ...empty };
  }
}
