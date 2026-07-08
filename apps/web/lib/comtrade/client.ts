/**
 * UN Comtrade+ REST client (comtradeapi.un.org/data/v1/get).
 *
 * Free tier: register at comtradeplus.un.org, subscribe to the free
 * APIs product, and set COMTRADE_API_KEY (sent as the standard
 * Ocp-Apim-Subscription-Key header). Free tier allows ~500 calls/day
 * with up to 100k records per call — the minerals cron makes one call
 * per HS code per month, far under the cap.
 *
 * Endpoint shape verified 2026-07-08 against the keyless
 * /public/v1/preview mirror: /data/v1/get/C/A/HS (C=commodities,
 * A=annual, HS classification) with cmdCode, flowCode=X,
 * partnerCode=0 (World), partner2Code=0, motCode=0 (all transport
 * modes), customsCode=C00 yields exactly one aggregate row per
 * reporter with primaryValue (USD) and netWgt (kg).
 */

const COMTRADE_BASE = 'https://comtradeapi.un.org/data/v1/get';
const USER_AGENT = 'eykon.ai/intel-ingest (+https://eykon.ai)';

export interface ComtradeFlowRow {
  reporter: string;
  period: string;
  value_usd: number | null;
  netweight_kg: number | null;
}

interface ComtradeApiRow {
  period?: string | number;
  reporterCode?: number;
  reporterISO?: string | null;
  reporterDesc?: string | null;
  flowCode?: string;
  motCode?: number | string;
  customsCode?: string;
  primaryValue?: number | null;
  netWgt?: number | null;
}

interface ComtradeResponse {
  count?: number;
  data?: ComtradeApiRow[];
  message?: string;
  statusCode?: number;
}

/**
 * Fetch annual world-partner export rows (one per reporter) for a
 * 4-digit HS code and year. Returns [] when the year has no data yet
 * (callers fall back a year); throws on HTTP/auth errors.
 */
export async function fetchComtradeAnnualExports(opts: {
  apiKey: string;
  hsCode: string;
  year: number;
}): Promise<ComtradeFlowRow[]> {
  const url = new URL(`${COMTRADE_BASE}/C/A/HS`);
  url.searchParams.set('cmdCode', opts.hsCode);
  url.searchParams.set('flowCode', 'X');
  url.searchParams.set('partnerCode', '0'); // World
  url.searchParams.set('partner2Code', '0');
  url.searchParams.set('motCode', '0'); // all modes of transport
  url.searchParams.set('customsCode', 'C00');
  url.searchParams.set('period', String(opts.year));
  url.searchParams.set('maxRecords', '500');
  url.searchParams.set('includeDesc', 'true');

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    headers: {
      'Ocp-Apim-Subscription-Key': opts.apiKey,
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      detail = body ? ` — ${body.slice(0, 300)}` : '';
    } catch {
      // ignore
    }
    throw new Error(`Comtrade: HTTP ${res.status} on HS ${opts.hsCode}${detail}`);
  }

  const body = (await res.json()) as ComtradeResponse;
  const rows = body.data ?? [];

  // One aggregate row per reporter is expected, but dedupe defensively:
  // duplicate (reporter, period) keys inside a single upsert batch make
  // Postgres reject the whole statement ("cannot affect row a second
  // time"). Keep the larger primaryValue when duplicates collide.
  const byReporter = new Map<string, ComtradeFlowRow>();
  for (const r of rows) {
    // Belt-and-braces: only the all-modes aggregate row.
    if (r.motCode != null && String(r.motCode) !== '0') continue;
    const reporter =
      (r.reporterDesc && r.reporterDesc.trim()) ||
      (r.reporterISO && r.reporterISO.trim()) ||
      (r.reporterCode != null ? String(r.reporterCode) : '');
    if (!reporter) continue;
    const value = typeof r.primaryValue === 'number' && Number.isFinite(r.primaryValue)
      ? r.primaryValue
      : null;
    const weight = typeof r.netWgt === 'number' && Number.isFinite(r.netWgt)
      ? r.netWgt
      : null;
    if (value == null && weight == null) continue;
    const row: ComtradeFlowRow = {
      reporter,
      period: String(r.period ?? opts.year),
      value_usd: value,
      netweight_kg: weight,
    };
    const existing = byReporter.get(reporter);
    if (!existing || (row.value_usd ?? 0) > (existing.value_usd ?? 0)) {
      byReporter.set(reporter, row);
    }
  }
  return Array.from(byReporter.values());
}
