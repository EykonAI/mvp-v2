import type { Resolver } from './types';

/**
 * Polymarket resolver.
 *
 * target_observable convention: `polymarket:<market_id>:<outcome>`
 *   e.g. `polymarket:0x1234abcd:Yes`
 *
 * Reads `polymarket_markets` (refreshed every 30 min by the PR-CAL-2
 * ingest cron). Resolves only once the market is `closed=true`:
 *
 *   • outcome_prices[outcome] == 1.0   → observed = 1.0 (the outcome won)
 *   • outcome_prices[outcome] == 0.0   → observed = 0.0 (the outcome lost)
 *   • intermediate values              → observed = the value (rare but
 *                                         honoured for scalar markets)
 *
 * If the market is still active when the resolver runs, returns null —
 * the next cron tick will retry. The deadline mismatch (we passed
 * resolves_at but Polymarket hasn't closed the market yet) is benign;
 * Polymarket close lags the event itself by minutes-to-hours.
 */
export const resolvePolymarket: Resolver = async (row, supabase) => {
  const parsed = parseTargetObservable(row.target_observable);
  if (!parsed) return null;

  const { data: market, error } = await supabase
    .from('polymarket_markets')
    .select('market_id, closed, outcome_prices')
    .eq('market_id', parsed.market_id)
    .maybeSingle();

  if (error || !market) return null;
  if (!market.closed) return null;

  const prices = market.outcome_prices as Record<string, number> | null;
  if (!prices || !(parsed.outcome in prices)) return null;

  const raw = Number(prices[parsed.outcome]);
  if (!Number.isFinite(raw)) return null;

  return {
    observed: Math.max(0, Math.min(1, raw)),
    source_url: `https://polymarket.com/market/${encodeURIComponent(parsed.market_id)}`,
  };
};

function parseTargetObservable(t: string): { market_id: string; outcome: string } | null {
  // Format: polymarket:<market_id>:<outcome>
  if (!t.startsWith('polymarket:')) return null;
  const rest = t.slice('polymarket:'.length);
  const colon = rest.lastIndexOf(':');
  if (colon <= 0) return null;
  const market_id = rest.slice(0, colon);
  const outcome = rest.slice(colon + 1);
  if (!market_id || !outcome) return null;
  return { market_id, outcome };
}
