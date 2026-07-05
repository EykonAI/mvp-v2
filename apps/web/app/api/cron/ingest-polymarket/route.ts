import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { fetchGammaMarkets, type PolymarketMarket } from '@/lib/polymarket/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Polymarket ingest · every 30 minutes.
 *
 * Pulls the ~50 highest-volume active markets and the ~50 highest-
 * volume recently-closed markets from Polymarket's Gamma REST API,
 * then upserts into polymarket_markets keyed by market_id.
 *
 * Active set: powers "eYKON vs. consensus" comparisons at issuance.
 * Closed set: powers source='polymarket' resolutions in PR-CAL-5.
 *
 * Idempotency: ON CONFLICT (market_id) DO UPDATE. Replays only refresh
 * last_seen_at + changed snapshot fields. first_seen_at is preserved
 * because the upsert payload deliberately omits it.
 *
 * Auth: Bearer <CRON_SECRET>. Recommended Railway schedule: every 30
 * minutes (every other half-hour for the active/closed split is also
 * fine; the cron is cheap).
 */
async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const startedAt = Date.now();
  const now = new Date().toISOString();

  let active: PolymarketMarket[] = [];
  let closed: PolymarketMarket[] = [];

  try {
    active = await fetchGammaMarkets({ closed: false, limit: 50 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'fetch_active',
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 502 },
    );
  }

  // Closed-market fetch is best-effort: if Polymarket transiently 5xx's
  // on the closed listing, we still want the active set persisted so
  // issuance lookups stay current. The next 30-minute run picks up the
  // missing closed rows.
  try {
    closed = await fetchGammaMarkets({ closed: true, limit: 50 });
  } catch {
    closed = [];
  }

  // De-dup by market_id: a market in transition can appear in both sets.
  const merged = new Map<string, PolymarketMarket>();
  for (const m of [...active, ...closed]) merged.set(m.market_id, m);

  const rows = Array.from(merged.values()).map((m) => ({
    market_id: m.market_id,
    question: m.question,
    outcomes: m.outcomes,
    outcome_prices: m.outcome_prices,
    volume: m.volume,
    active: m.active,
    closed: m.closed,
    closed_at: m.closed_at,
    end_date: m.end_date,
    last_seen_at: now,
    // first_seen_at omitted on purpose — DEFAULT NOW() fires only on
    // INSERT, and supabase-js's upsert doesn't add omitted columns to
    // the ON CONFLICT SET list. Existing rows keep their original
    // first_seen_at; new rows get NOW().
  }));

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      active: 0,
      closed: 0,
      upserted: 0,
      elapsed_ms: Date.now() - startedAt,
    });
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from('polymarket_markets')
    .upsert(rows, { onConflict: 'market_id', count: 'exact' });

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'upsert',
        error: error.message,
        active: active.length,
        closed: closed.length,
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    active: active.length,
    closed: closed.length,
    upserted: count ?? rows.length,
    elapsed_ms: Date.now() - startedAt,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
