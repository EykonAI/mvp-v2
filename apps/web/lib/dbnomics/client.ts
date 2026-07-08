/**
 * DBnomics REST client (api.db.nomics.world/v22) — free, keyless JSON
 * mirror of official statistical providers.
 *
 * Used by /api/cron/ingest-commodity-prices for monthly commodity
 * prices from the IMF Primary Commodity Price System (PCPS). Note: the
 * WB CMO "Pink Sheet" mirror on DBnomics (WB/commodity_prices) is
 * ANNUAL history + projections, not the monthly sheet — IMF/PCPS is
 * the monthly mirror and carries every workspace slug incl. lithium
 * and rare earths (verified 2026-07-08).
 */

const DBNOMICS_BASE = 'https://api.db.nomics.world/v22';
const USER_AGENT = 'eykon.ai/intel-ingest (+https://eykon.ai)';

export interface DbnomicsObservation {
  /** First day of the period, YYYY-MM-DD (DBnomics period_start_day). */
  period: string;
  value: number;
}

interface DbnomicsSeriesDoc {
  provider_code?: string;
  dataset_code?: string;
  series_code?: string;
  period?: string[];
  period_start_day?: string[];
  value?: Array<number | string | null>;
}

interface DbnomicsResponse {
  series?: {
    docs?: DbnomicsSeriesDoc[];
  };
  message?: string;
}

/**
 * Fetch multiple series in one request via /v22/series?series_ids=…
 * (full ids like 'IMF/PCPS/M.W00.POILBRE.USD'). Returns a map keyed by
 * full series id; series absent from the response are simply missing
 * from the map — callers decide whether that is an error. Throws on
 * HTTP or envelope errors.
 */
export async function fetchDbnomicsSeries(
  seriesIds: string[],
): Promise<Map<string, DbnomicsObservation[]>> {
  const url = new URL(`${DBNOMICS_BASE}/series`);
  url.searchParams.set('series_ids', seriesIds.join(','));
  url.searchParams.set('observations', '1');

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      detail = body ? ` — ${body.slice(0, 300)}` : '';
    } catch {
      // ignore
    }
    throw new Error(`DBnomics: HTTP ${res.status}${detail}`);
  }

  const body = (await res.json()) as DbnomicsResponse;
  if (!body.series?.docs) {
    throw new Error(`DBnomics: unexpected envelope${body.message ? ` — ${body.message}` : ''}`);
  }

  const out = new Map<string, DbnomicsObservation[]>();
  for (const doc of body.series.docs) {
    const id = `${doc.provider_code}/${doc.dataset_code}/${doc.series_code}`;
    const periods = doc.period_start_day ?? doc.period ?? [];
    const values = doc.value ?? [];
    const obs: DbnomicsObservation[] = [];
    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const value = values[i] == null ? NaN : Number(values[i]);
      if (typeof period !== 'string' || !Number.isFinite(value)) continue;
      obs.push({ period, value });
    }
    out.set(id, obs);
  }
  return out;
}
