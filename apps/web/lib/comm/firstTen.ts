import type { SupabaseClient } from '@supabase/supabase-js';

// "The First Ten" (Founding Partner build-prompt §7) — the fastest
// HONEST road to a shown Reputation Note (10 resolved + skill ≥ 0).
//
// User predictions on eYKON are Polymarket-market-based (commit-reveal
// via /api/comm/predict, auto-scored by the polymarket resolver when
// the market closes). So "fast-resolving" has exactly one truthful
// meaning here: OPEN markets whose scheduled close (end_date, mig 077)
// is soonest. This module surfaces those — it invents nothing, and a
// call made from a template is an ordinary sealed prediction scored
// like any other. No synthetic claims, no unresolvable templates.

export const FIRST_TEN_TARGET = 10;
// A market must close within this window to count as "fast-resolving".
export const FAST_CLOSE_DAYS = 14;

export type FastMarket = {
  market_id: string;
  question: string;
  outcomes: string[];
  prices: Record<string, number>;
  end_date: string; // ISO — guaranteed non-null by the query
  days_to_close: number;
};

export async function loadFastClosingMarkets(
  admin: SupabaseClient,
  limit = 10,
): Promise<FastMarket[]> {
  const now = Date.now();
  const horizon = new Date(now + FAST_CLOSE_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('polymarket_markets')
    .select('market_id, question, outcomes, outcome_prices, end_date')
    .eq('closed', false)
    .not('end_date', 'is', null)
    .gt('end_date', new Date(now).toISOString())
    .lte('end_date', horizon)
    .order('end_date', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return (data as {
    market_id: string;
    question: string | null;
    outcomes: unknown;
    outcome_prices: unknown;
    end_date: string;
  }[]).map(m => ({
    market_id: m.market_id,
    question: m.question ?? '',
    outcomes: Array.isArray(m.outcomes) ? (m.outcomes as unknown[]).map(String) : [],
    prices:
      m.outcome_prices && typeof m.outcome_prices === 'object'
        ? (m.outcome_prices as Record<string, number>)
        : {},
    end_date: m.end_date,
    days_to_close: Math.max(Math.ceil((Date.parse(m.end_date) - now) / 86_400_000), 0),
  }));
}
