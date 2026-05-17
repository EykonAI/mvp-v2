/**
 * EIA v2 REST client — weekly petroleum stocks endpoint.
 *
 * The v2 API (api.eia.gov/v2) requires a free API key. Get one at
 * https://www.eia.gov/opendata/register.php and set EIA_API_KEY in the
 * Railway env. Used by /api/cron/ingest-eia-inventory and (later by
 * PR-CAL-5's per-source resolver) by /api/cron/score-predictions.
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
 * Fetch the most recent `length` observations of a weekly petroleum
 * stocks series. Returns an empty array if the API responds with no
 * data; throws on HTTP error so the cron can surface the stage.
 */
export async function fetchEiaWeeklyStocks(opts: {
  apiKey: string;
  seriesId: string;
  length?: number;
}): Promise<EiaObservation[]> {
  const length = opts.length ?? 12;
  const url = new URL(`${EIA_BASE}/petroleum/stoc/wstk/data/`);
  url.searchParams.set('api_key', opts.apiKey);
  url.searchParams.set('frequency', 'weekly');
  url.searchParams.append('data[]', 'value');
  url.searchParams.append('facets[series][]', opts.seriesId);
  url.searchParams.append('sort[][column]', 'period');
  url.searchParams.append('sort[][direction]', 'desc');
  url.searchParams.set('offset', '0');
  url.searchParams.set('length', String(length));

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`EIA v2: HTTP ${res.status} on ${url.pathname}`);
  }

  const body = (await res.json()) as EiaV2Response;
  const rows = body.response?.data ?? [];

  return rows
    .map((r): EiaObservation | null => {
      const period = typeof r.period === 'string' ? r.period : null;
      const value = r.value == null ? NaN : Number(r.value);
      if (!period || !Number.isFinite(value)) return null;
      return {
        series_id: opts.seriesId,
        period,
        value,
        unit: typeof r.units === 'string' && r.units ? r.units : 'MBBL',
      };
    })
    .filter((r): r is EiaObservation => r !== null);
}

// Series ID for Cushing, OK ending stocks of crude oil (thousand
// barrels, weekly). The default target for the weekly issuer.
export const EIA_CUSHING_CRUDE_STOCKS = 'W_EPC0_SAX_YCUOK_MBBL';
