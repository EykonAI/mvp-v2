import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import {
  EIA_CUSHING_CRUDE_STOCKS,
  fetchEiaWeeklyStocks,
} from '@/lib/eia/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * EIA weekly inventory ingest · daily.
 *
 * Pulls the latest 12 weeks of Cushing, OK crude stocks from the EIA
 * v2 API and upserts into eia_inventory_observations keyed by
 * (series_id, period). Runs daily because the EIA Weekly Petroleum
 * Status Report drops on Wednesdays at ~10:30 ET — daily polling means
 * we catch the new print within hours regardless of timezone drift.
 *
 * Idempotency: ON CONFLICT (series_id, period) DO UPDATE refreshes
 * the value (revisions happen) and fetched_at. New periods land on
 * the first Wednesday-evening fire after publication.
 *
 * Requires: EIA_API_KEY env var (free signup at
 * https://www.eia.gov/opendata/register.php).
 */
async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'EIA_API_KEY not configured on the server' },
      { status: 500 },
    );
  }

  const startedAt = Date.now();
  const supabase = createServerSupabase();
  const now = new Date().toISOString();

  let observations;
  try {
    observations = await fetchEiaWeeklyStocks({
      apiKey,
      seriesId: EIA_CUSHING_CRUDE_STOCKS,
      length: 12,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'fetch',
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 502 },
    );
  }

  if (observations.length === 0) {
    return NextResponse.json({
      ok: true,
      series_id: EIA_CUSHING_CRUDE_STOCKS,
      fetched: 0,
      upserted: 0,
      elapsed_ms: Date.now() - startedAt,
    });
  }

  const rows = observations.map((o) => ({
    series_id: o.series_id,
    period: o.period,
    value: o.value,
    unit: o.unit,
    fetched_at: now,
  }));

  const { error, count } = await supabase
    .from('eia_inventory_observations')
    .upsert(rows, { onConflict: 'series_id,period', count: 'exact' });

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'upsert',
        error: error.message,
        fetched: rows.length,
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    series_id: EIA_CUSHING_CRUDE_STOCKS,
    fetched: rows.length,
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
