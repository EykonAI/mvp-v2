import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import {
  EIA_WEEKLY_STOCK_SERIES,
  fetchEiaWeeklyStocks,
} from '@/lib/eia/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * EIA weekly inventory ingest · daily.
 *
 * Pulls the latest 12 weeks of each EIA_WEEKLY_STOCK_SERIES entry
 * (Cushing crude, total US crude excl. SPR, total gasoline, total
 * distillate) from the EIA v2 API and upserts into
 * eia_inventory_observations keyed by (series_id, period). Runs daily
 * because the EIA Weekly Petroleum Status Report drops on Wednesdays at
 * ~10:30 ET — daily polling means we catch the new print within hours
 * regardless of timezone drift.
 *
 * Idempotency: ON CONFLICT (series_id, period) DO UPDATE refreshes
 * the value (revisions happen) and fetched_at. New periods land on
 * the first Wednesday-evening fire after publication.
 *
 * Per-series isolation: one series failing (fetch or upsert) is
 * recorded in errors[] and does not block the others; ok=false only
 * when every series failed.
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

  const errors: string[] = [];
  const perSeries: Record<string, { fetched: number; upserted: number }> = {};
  let fetchedTotal = 0;
  let upsertedTotal = 0;

  for (const series of EIA_WEEKLY_STOCK_SERIES) {
    let observations;
    try {
      observations = await fetchEiaWeeklyStocks({
        apiKey,
        seriesId: series.id,
        length: 12,
      });
    } catch (err) {
      errors.push(
        `${series.id} fetch: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (observations.length === 0) {
      perSeries[series.id] = { fetched: 0, upserted: 0 };
      continue;
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
      errors.push(`${series.id} upsert: ${error.message}`);
      continue;
    }

    const upserted = count ?? rows.length;
    perSeries[series.id] = { fetched: rows.length, upserted };
    fetchedTotal += rows.length;
    upsertedTotal += upserted;
  }

  const allFailed = Object.keys(perSeries).length === 0 && errors.length > 0;

  return NextResponse.json(
    {
      ok: !allFailed,
      series: perSeries,
      fetched: fetchedTotal,
      upserted: upsertedTotal,
      errors,
      elapsed_ms: Date.now() - startedAt,
    },
    { status: allFailed ? 502 : 200 },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
