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

// ── FIRMS facility templates ───────────────────────────────────
//
// The second observable family a creator can call on (migration 081).
// Polymarket only covers what a betting market happens to list, which
// left conflict / energy-infrastructure analysts with nothing in their
// own beat to be scored on. A FIRMS call is resolved by eYKON's own
// ingest: "will a thermal anomaly be DETECTED within <radius> km of
// this facility in the next <N> days?"
//
// HONESTY: a detection is a hot pixel, not a confirmed fire and not a
// strike. The wording below says "detected" everywhere and must keep
// saying it — attribution belongs in the analyst's prose, never in the
// resolution. See lib/predictions/resolvers/firms.ts.
export const FIRMS_WINDOW_DAYS = 7;

export type FirmsTemplate = {
  facility_type: string;
  facility_id: string;
  facility_name: string;
  country: string | null;
  // Detections at this facility over the trailing baseline window —
  // shown so the creator calls with context, not blind.
  recent_detections: number;
  baseline_days: number;
  window_days: number;
  question: string;
};

const FIRMS_BASELINE_DAYS = 30;

/**
 * Surface monitored facilities as callable First Ten templates.
 *
 * Ordering favours facilities with SOME recent activity — those are
 * where the outcome is genuinely uncertain, which is where a call
 * carries information. A facility that never registers anything is a
 * near-certain "not detected" and teaches the ledger nothing.
 */
export async function loadFirmsFacilityTemplates(
  admin: SupabaseClient,
  limit = 8,
): Promise<FirmsTemplate[]> {
  const since = new Date(Date.now() - FIRMS_BASELINE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await admin
    .from('firms_facility_observations')
    .select('facility_type, facility_id, facility_name, country, detection_count, period')
    .gte('period', since)
    .order('period', { ascending: false })
    .limit(4000);

  if (error || !data) return [];

  type Row = {
    facility_type: string;
    facility_id: string;
    facility_name: string | null;
    country: string | null;
    detection_count: number | null;
  };

  const agg = new Map<string, FirmsTemplate>();
  for (const r of data as Row[]) {
    const key = `${r.facility_type}:${r.facility_id}`;
    const prev = agg.get(key);
    const count = Number(r.detection_count) || 0;
    if (prev) {
      prev.recent_detections += count;
      continue;
    }
    const name = r.facility_name ?? r.facility_id;
    agg.set(key, {
      facility_type: r.facility_type,
      facility_id: r.facility_id,
      facility_name: name,
      country: r.country,
      recent_detections: count,
      baseline_days: FIRMS_BASELINE_DAYS,
      window_days: FIRMS_WINDOW_DAYS,
      question: `Will a thermal anomaly be detected within 5 km of ${name}${
        r.country ? ` (${r.country})` : ''
      } in the next ${FIRMS_WINDOW_DAYS} days?`,
    });
  }

  return Array.from(agg.values())
    .filter((t) => t.recent_detections > 0)
    .sort((a, b) => a.recent_detections - b.recent_detections)
    .slice(0, limit);
}

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
