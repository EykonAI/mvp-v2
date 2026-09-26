/**
 * Copernicus Data Space Ecosystem (CDSE) — Sentinel Hub client.
 *
 * Endpoints as used by ingest-sentinel-tiles since mig 080 (verified then
 * against documentation.dataspace.copernicus.eu). Auth is OAuth2 client
 * credentials: CDSE_CLIENT_ID / CDSE_CLIENT_SECRET.
 *
 * Processing units. CDSE documents no response header reporting PU spent,
 * so cost is ESTIMATED from the documented definition — 1 PU = 512×512 px
 * output × 3 input bands × 1 data sample at ≤16 bit, scaled linearly, with
 * a floor of 0.01 PU per Statistical request and 0.005 PU per Process
 * request (documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/
 * ProcessingUnit.html, read 2026-09-26). The estimate is stored as such;
 * it is never presented as a metered figure.
 */

const TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
export const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
export const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

const PU_FLOOR_STATS = 0.01;

/**
 * Rate limits. The first production run (2026-09-26 22:17 UTC) had 8 of 27
 * AOIs refused with HTTP 429 RATE_LIMIT_EXCEEDED inside half a second: the
 * engine fired requests back to back. Every CDSE call now goes through
 * cdseFetch(), which on a 429 (or 503) waits Retry-After — or 10 s, 20 s,
 * 40 s — and tries again, at most 3 times. A request still refused after
 * that throws, the AOI's check is logged as an error, and it stays due.
 */
const RETRY_STATUSES = new Set([429, 503]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 10_000;

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function cdseFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, cache: 'no-store' });
    if (!RETRY_STATUSES.has(res.status) || attempt >= MAX_RETRIES) {
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}${attempt ? ` (after ${attempt} retries)` : ''}`);
      return res;
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 60_000)
      : BASE_BACKOFF_MS * 2 ** attempt;
    await res.text().catch(() => undefined);
    await sleep(waitMs);
  }
}
const PU_FLOOR_PROCESS = 0.005;

export function estimatePu(opts: {
  width: number;
  height: number;
  inputBands: number;
  samples: number;
  api: 'statistics' | 'process';
}): number {
  const area = (opts.width * opts.height) / (512 * 512);
  const bands = opts.inputBands / 3;
  const raw = area * bands * Math.max(1, opts.samples);
  const floor = opts.api === 'statistics' ? PU_FLOOR_STATS : PU_FLOOR_PROCESS;
  return Math.round(Math.max(raw, floor) * 10000) / 10000;
}

export async function fetchCdseToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`CDSE token: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('CDSE token: no access_token in response');
  return json.access_token;
}

export interface BandStats {
  mean?: number;
  sampleCount?: number;
  noDataCount?: number;
  percentiles?: Record<string, number>;
}

export interface StatsInterval {
  interval: { from: string; to: string };
  outputs?: Record<string, { bands?: Record<string, { stats?: BandStats }> }>;
}

/** POST a Statistical API request; returns the per-interval data array. */
export async function postStatistics(token: string, body: unknown): Promise<StatsInterval[]> {
  const res = await cdseFetch(STATS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 'statistics');
  const json = (await res.json()) as { data?: StatsInterval[]; status?: string };
  return json.data ?? [];
}

/** POST a Process API request expecting a PNG. */
export async function postProcessPng(token: string, body: unknown): Promise<ArrayBuffer> {
  const res = await cdseFetch(PROCESS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'image/png' },
    body: JSON.stringify(body),
  }, 'process');
  return res.arrayBuffer();
}

/** First band's stats of one output of one interval, or null. */
export function bandStats(iv: StatsInterval, output: string): BandStats | null {
  const bands = iv.outputs?.[output]?.bands;
  if (!bands) return null;
  const first = Object.values(bands)[0];
  return first?.stats ?? null;
}

/** The 50th percentile from a stats block, whatever its key spelling ("50", "50.0"). */
export function medianOf(stats: BandStats | null): number | null {
  const p = stats?.percentiles;
  if (!p) return null;
  for (const [k, v] of Object.entries(p)) {
    if (Number(k) === 50 && typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
