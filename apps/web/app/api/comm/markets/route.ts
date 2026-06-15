import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';

// Open Polymarket markets for the "make a call" picker (Reputation
// Engine A3b). Authed-only. Returns the live crowd prices so the UI can
// show the baseline a user's call will be scored against.

export const dynamic = 'force-dynamic';

interface MarketRow {
  market_id: string;
  question: string | null;
  outcomes: unknown;
  outcome_prices: unknown;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('polymarket_markets')
    .select('market_id, question, outcomes, outcome_prices, volume')
    .eq('closed', false)
    .order('volume', { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const markets = ((data ?? []) as MarketRow[]).map((m) => ({
    market_id: m.market_id,
    question: m.question ?? '',
    outcomes: Array.isArray(m.outcomes) ? (m.outcomes as unknown[]).map(String) : [],
    prices:
      m.outcome_prices && typeof m.outcome_prices === 'object'
        ? (m.outcome_prices as Record<string, number>)
        : {},
  }));
  return NextResponse.json({ markets });
}
