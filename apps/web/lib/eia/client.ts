/**
 * EIA v2 REST client — weekly petroleum stocks + daily spot prices.
 *
 * The v2 API (api.eia.gov/v2) requires a free API key. Get one at
 * https://www.eia.gov/opendata/register.php and set EIA_API_KEY in the
 * Railway env. Used by /api/cron/ingest-eia-inventory,
 * /api/cron/ingest-commodity-prices and (via PR-CAL-5's per-source
 * resolver) /api/cron/score-predictions.
 */

const EIA_BASE = 'https://api.eia.gov/v2';
const USER_AGENT = 'eykon.ai/calibration-ledger (+https://eykon.ai)';

export interface EiaObservation {
  series_id: string;
  period: string; // YYYY-MM-DD
  value: number;
  unit: string;
}

interface EiaV2DataRow {
  period?: string;
  value?: string | number | null;
  series?: string;
  units?: string;
}

interface EiaV2Response {
  response?: {
    data?: EiaV2DataRow[];
  };
}

/**
 * Generic EIA v2 series fetch: most recent `length` observations of one
 * series on one route/frequency, newest first. Returns an empty array if
 * the API responds with no data; throws on HTTP error so callers can
 * surface the stage.
 */
export async function fetchEiaSeries(opts: {
  apiKey: string;
  /** v2 route below /v2, e.g. 'petroleum/stoc/wstk' or 'petroleum/pri/spt'. */
  route: string;
  frequency: 'weekly' | 'daily';
  seriesId: string;
  length?: number;
  /** Fallback unit when the API omits `units` on a row. */
  defaultUnit?: string;
}): Promise<EiaObservation[]> {
  const length = opts.length ?? 12;
  const url = new URL(`${EIA_BASE}/${opts.route}/data/`);
  // EIA v2's query parser requires explicit numeric indices for nested
  // arrays — `data[]`, `sort[][column]` etc. all reject with HTTP 400.
  // Single-level arrays like `facets[series][]` are accepted.
  url.searchParams.set('api_key', opts.apiKey);
  url.searchParams.set('frequency', opts.frequency);
  url.searchParams.set('data[0]', 'value');
  url.searchParams.append('facets[series][]', opts.seriesId);
  url.searchParams.set('sort[0][column]', 'period');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('offset', '0');
  url.searchParams.set('length', String(length));

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) {
    // Capture the EIA error body so 4xx triage doesn't require a code change.
    // Strip the api_key from the path before surfacing — never echo secrets
    // back into the cron's JSON response.
    let detail = '';
    try {
      const body = await res.text();
      detail = body ? ` — ${body.slice(0, 400)}` : '';
    } catch {
      // ignore
    }
    throw new Error(`EIA v2: HTTP ${res.status} on ${url.pathname}${detail}`);
  }

  const body = (await res.json()) as EiaV2Response;
  const rows = body.response?.data ?? [];
  const defaultUnit = opts.defaultUnit ?? 'MBBL';

  return rows
    .map((r): EiaObservation | null => {
      const period = typeof r.period === 'string' ? r.period : null;
      const value = r.value == null ? NaN : Number(r.value);
      if (!period || !Number.isFinite(value)) return null;
      return {
        series_id: opts.seriesId,
        period,
        value,
        unit: typeof r.units === 'string' && r.units ? r.units : defaultUnit,
      };
    })
    .filter((r): r is EiaObservation => r !== null);
}

/**
 * Fetch the most recent `length` observations of a weekly petroleum
 * stocks series (thin wrapper kept for the prediction issuer/resolver).
 */
export async function fetchEiaWeeklyStocks(opts: {
  apiKey: string;
  seriesId: string;
  length?: number;
}): Promise<EiaObservation[]> {
  return fetchEiaSeries({
    apiKey: opts.apiKey,
    route: 'petroleum/stoc/wstk',
    frequency: 'weekly',
    seriesId: opts.seriesId,
    length: opts.length,
    defaultUnit: 'MBBL',
  });
}

/**
 * Fetch the most recent `length` observations of a daily petroleum spot
 * price series (petroleum/pri/spt — RBRTE, RWTC).
 */
export async function fetchEiaDailySpot(opts: {
  apiKey: string;
  seriesId: string;
  length?: number;
}): Promise<EiaObservation[]> {
  return fetchEiaSeries({
    apiKey: opts.apiKey,
    route: 'petroleum/pri/spt',
    frequency: 'daily',
    seriesId: opts.seriesId,
    length: opts.length ?? 60,
    defaultUnit: '$/BBL',
  });
}

// Series ID for Cushing, OK ending stocks of crude oil (thousand
// barrels, weekly). The default target for the weekly issuer.
export const EIA_CUSHING_CRUDE_STOCKS = 'W_EPC0_SAX_YCUOK_MBBL';

/**
 * Weekly petroleum stock series ingested by /api/cron/ingest-eia-inventory.
 * Ids verified against EIA dnav (eia.gov/dnav/pet/hist/LeafHandler.ashx):
 *  - W_EPC0_SAX_YCUOK_MBBL — Cushing, OK ending stocks of crude oil
 *  - WCESTUS1 — Weekly U.S. Ending Stocks excluding SPR of Crude Oil
 *  - WGTSTUS1 — Weekly U.S. Ending Stocks of Total Gasoline
 *  - WDISTUS1 — Weekly U.S. Ending Stocks of Distillate Fuel Oil
 * All thousand barrels.
 */
export const EIA_WEEKLY_STOCK_SERIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: EIA_CUSHING_CRUDE_STOCKS, label: 'Cushing, OK crude ending stocks' },
  { id: 'WCESTUS1', label: 'US crude ending stocks excl. SPR' },
  { id: 'WGTSTUS1', label: 'US total motor gasoline ending stocks' },
  { id: 'WDISTUS1', label: 'US total distillate ending stocks' },
];

// Daily spot price series (dollars per barrel), verified against EIA dnav:
// rbrteD.htm — Europe Brent Spot Price FOB; rwtcD.htm — Cushing, OK WTI
// Spot Price FOB.
export const EIA_BRENT_SPOT = 'RBRTE';
export const EIA_WTI_SPOT = 'RWTC';

// ─── NYMEX futures (front months 1–4) ─────────────────────────────
//
// EIA republishes NYMEX settlement prices as daily series — free and
// official, same key as the spot layer. WTI (Cushing) and Henry Hub
// natural gas only: EIA carries no Brent or TTF futures, and we do not
// substitute a lookalike. Henry Hub rows are stored under the
// 'henry_hub' commodity key, never under 'ttf' — the UI labels them as
// the US benchmark explicitly (Grounding Brief 2026-08-09 rev. B §4.2).
export const EIA_WTI_FUTURES: ReadonlyArray<{ month: 1 | 2 | 3 | 4; seriesId: string }> = [
  { month: 1, seriesId: 'RCLC1' },
  { month: 2, seriesId: 'RCLC2' },
  { month: 3, seriesId: 'RCLC3' },
  { month: 4, seriesId: 'RCLC4' },
];
export const EIA_HH_FUTURES: ReadonlyArray<{ month: 1 | 2 | 3 | 4; seriesId: string }> = [
  { month: 1, seriesId: 'RNGC1' },
  { month: 2, seriesId: 'RNGC2' },
  { month: 3, seriesId: 'RNGC3' },
  { month: 4, seriesId: 'RNGC4' },
];

/** Newest settlement for one futures contract series. */
export async function fetchEiaFuturesLatest(opts: {
  apiKey: string;
  route: 'petroleum/pri/fut' | 'natural-gas/pri/fut';
  seriesId: string;
  defaultUnit: string;
}): Promise<EiaObservation | null> {
  // length 7 tolerates weekends/holidays; rows arrive newest-first.
  const obs = await fetchEiaSeries({
    apiKey: opts.apiKey,
    route: opts.route,
    frequency: 'daily',
    seriesId: opts.seriesId,
    length: 7,
    defaultUnit: opts.defaultUnit,
  });
  return obs[0] ?? null;
}
