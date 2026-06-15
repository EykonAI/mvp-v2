import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { computePredictionHash } from '@/lib/predictions/hash';

// "Make a call" — author a user prediction against an open Polymarket
// market (Reputation Engine A3b). The call is PUBLIC and auto-scored by
// the existing polymarket resolver once the market closes; baseline_mean
// is captured as the crowd price at call time, so Brier-skill measures
// beating the market. resolves_at is set to now() — the resolver defers
// (returns null) every tick until the market actually closes.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MarketRow {
  question: string | null;
  outcomes: unknown;
  outcome_prices: unknown;
  closed: boolean | null;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { market_id?: unknown; outcome?: unknown; probability?: unknown };
  try {
    body = (await req.json()) as { market_id?: unknown; outcome?: unknown; probability?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const marketId = typeof body.market_id === 'string' ? body.market_id : '';
  const outcome = typeof body.outcome === 'string' ? body.outcome : '';
  const probability = Number(body.probability);
  if (!marketId || !outcome || !Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { data: market } = await supabase
    .from('polymarket_markets')
    .select('question, outcomes, outcome_prices, closed')
    .eq('market_id', marketId)
    .maybeSingle();
  if (!market) return NextResponse.json({ error: 'market_not_found' }, { status: 404 });

  const m = market as MarketRow;
  if (m.closed) return NextResponse.json({ error: 'market_closed' }, { status: 400 });

  const outcomes = Array.isArray(m.outcomes) ? (m.outcomes as unknown[]).map(String) : [];
  if (!outcomes.includes(outcome)) return NextResponse.json({ error: 'invalid_outcome' }, { status: 400 });

  const prices =
    m.outcome_prices && typeof m.outcome_prices === 'object'
      ? (m.outcome_prices as Record<string, unknown>)
      : {};
  const baselineRaw = Number(prices[outcome]);
  const baseline = Number.isFinite(baselineRaw) ? Math.max(0, Math.min(1, baselineRaw)) : null;

  const targetObservable = `polymarket:${marketId}:${outcome}`;

  const { data: existing } = await supabase
    .from('predictions_register')
    .select('id')
    .eq('author_id', user.id)
    .eq('target_observable', targetObservable)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: 'already_called' }, { status: 409 });

  const now = new Date();
  const pct = Math.round(probability * 100);
  const statement = `${String(m.question ?? 'Market')} — ${outcome} @ ${pct}%`;
  const hash = computePredictionHash({
    statement,
    targetObservable,
    resolvesAt: now,
    issuedAt: now,
    predictedMean: probability,
  });

  const { data: inserted, error } = await supabase
    .from('predictions_register')
    .insert({
      feature: 'polymarket',
      context: { kind: 'user_call', market_id: marketId, outcome },
      predicted_distribution: { mean: probability, type: 'point' },
      target_observable: targetObservable,
      target_window_hours: 0,
      issued_at: now.toISOString(),
      resolves_at: now.toISOString(),
      persona: 'analyst',
      statement,
      source: 'polymarket',
      hash,
      author_id: user.id,
      baseline_mean: baseline,
      visibility: 'public',
    })
    .select('public_id')
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? 'insert_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, public_id: inserted.public_id });
}
