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
  const res = await fetch(STATS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`statistics: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data?: StatsInterval[]; status?: string };
  return json.data ?? [];
}

/** POST a Process API request expecting a PNG. */
export async function postProcessPng(token: string, body: unknown): Promise<ArrayBuffer> {
  const res = await fetch(PROCESS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'image/png' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`process: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
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
