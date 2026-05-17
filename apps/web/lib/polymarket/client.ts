/**
 * Polymarket Gamma REST client.
 *
 * The Gamma API (gamma-api.polymarket.com) is the documented public
 * read endpoint for market metadata and outcome prices. Keyless. Used
 * by the /api/cron/ingest-polymarket cron and (in PR-CAL-5) by the
 * per-source resolver in /api/cron/score-predictions.
 */

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const USER_AGENT = 'eykon.ai/calibration-ledger (+https://eykon.ai)';

export interface GammaMarketRaw {
  id?: string | number;
  question?: string;
  outcomes?: string | string[];        // Gamma returns stringified JSON arrays
  outcomePrices?: string | string[];   // for both `outcomes` and `outcomePrices`
  volume?: string | number;
  active?: boolean;
  closed?: boolean;
  closedTime?: string | null;
  endDate?: string | null;
}

export interface PolymarketMarket {
  market_id: string;
  question: string;
  outcomes: string[];
  outcome_prices: Record<string, number>;
  volume: number | null;
  active: boolean;
  closed: boolean;
  closed_at: string | null;
}

function asArray(v: string | string[] | undefined): string[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseGammaMarket(raw: GammaMarketRaw): PolymarketMarket | null {
  if (raw.id == null || !raw.question) return null;

  const outcomes = asArray(raw.outcomes);
  const pricesRaw = asArray(raw.outcomePrices);
  if (!outcomes || !pricesRaw) return null;
  if (outcomes.length === 0 || outcomes.length !== pricesRaw.length) return null;

  const prices = pricesRaw.map((p) => Number(p));
  if (prices.some((p) => !Number.isFinite(p))) return null;

  const outcome_prices: Record<string, number> = {};
  outcomes.forEach((name, i) => {
    outcome_prices[String(name)] = prices[i];
  });

  const volumeNum = Number(raw.volume);
  const closedAt =
    typeof raw.closedTime === 'string' && raw.closedTime
      ? raw.closedTime
      : typeof raw.endDate === 'string' && raw.closed === true
        ? raw.endDate
        : null;

  return {
    market_id: String(raw.id),
    question: String(raw.question),
    outcomes: outcomes.map(String),
    outcome_prices,
    volume: Number.isFinite(volumeNum) ? volumeNum : null,
    active: raw.active !== false,
    closed: raw.closed === true,
    closed_at: closedAt,
  };
}

export async function fetchGammaMarkets(opts: {
  closed: boolean;
  limit: number;
  order?: string;
}): Promise<PolymarketMarket[]> {
  const params = new URLSearchParams({
    limit: String(opts.limit),
    order: opts.order ?? 'volume',
    ascending: 'false',
    closed: String(opts.closed),
  });
  // For the active set we also want to exclude paused / non-active markets.
  if (!opts.closed) params.set('active', 'true');

  const url = `${GAMMA_BASE}/markets?${params.toString()}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Polymarket Gamma: HTTP ${res.status} on ${url}`);

  const body: unknown = await res.json();
  const raws: GammaMarketRaw[] = Array.isArray(body) ? (body as GammaMarketRaw[]) : [];
  return raws
    .map(parseGammaMarket)
    .filter((m): m is PolymarketMarket => m !== null);
}
