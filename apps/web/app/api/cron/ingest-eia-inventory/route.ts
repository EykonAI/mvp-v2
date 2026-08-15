import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import {
  EIA_WEEKLY_STOCK_SERIES,
  fetchEiaWeeklyStocks,
} from '@/lib/eia/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 300, matching the other heavy ingest routes (ingest-comtrade-minerals,
// ingest-gem-*, build-entity-graph). 60 was never right for this route and
// the routine tick proved it: a 4-series × 12-observation run measured
// elapsed_ms 58,960 on 2026-08-15 — 98% of the old budget, before any
// backfill. The cost is EIA v2 request latency (~14 s per series), not row
// count, so it is nearly fixed per series regardless of `length`.
export const maxDuration = 300;

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
 *
 * BACKFILL: pass ?length=N (bounded by MAX_LENGTH) for a one-off deep
 * pull, and ?series=<id> to do it one series at a time. The scheduled
 * tick passes neither and keeps DEFAULT_LENGTH across all series;
 * nothing about the schedule needs to change to run a backfill.
 *
 * Backfill one series at a time. Each series costs ~14 s in EIA request
 * latency alone, so four at once sits close to the ceiling even with
 * maxDuration 300 — and a timeout mid-loop leaves the later series
 * untouched with no signal about how far it got. Per-series requests
 * fail small and are trivially resumable.
 */
const DEFAULT_LENGTH = 12;
const MAX_LENGTH = 600; // ~11.5 years of weekly prints

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

  // Per-run history depth. The scheduled tick only ever needs the last few
  // weeks — it runs weekly and upserts on (series_id, period), so 12 gives
  // ample overlap against a missed run. A ONE-OFF BACKFILL passes ?length=N
  // to pull real history: the forecaster in lib/predictions/issue-eia-weekly.ts
  // shrinks the recent regime toward a long-run anchor, and that anchor is
  // only meaningful with years of prints rather than the months this cron
  // accretes on its own. Bounded at MAX_LENGTH because EIA v2 paginates and
  // an unbounded length silently truncates rather than erroring.
  const requestedLength = Number(
    new URL(req.url).searchParams.get('length') ?? DEFAULT_LENGTH,
  );
  const length =
    Number.isFinite(requestedLength) && requestedLength > 0
      ? Math.min(Math.floor(requestedLength), MAX_LENGTH)
      : DEFAULT_LENGTH;

  // Optional single-series filter for backfills. Unknown ids are a hard
  // 400 rather than a silent empty run — a backfill that quietly does
  // nothing and reports ok:true is the exact failure this codebase keeps
  // rediscovering.
  const seriesFilter = new URL(req.url).searchParams.get('series');
  const targetSeries = seriesFilter
    ? EIA_WEEKLY_STOCK_SERIES.filter((s) => s.id === seriesFilter)
    : EIA_WEEKLY_STOCK_SERIES;

  if (seriesFilter && targetSeries.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `unknown series '${seriesFilter}'`,
        known_series: EIA_WEEKLY_STOCK_SERIES.map((s) => s.id),
      },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  const perSeries: Record<string, { fetched: number; upserted: number }> = {};
  let fetchedTotal = 0;
  let upsertedTotal = 0;

  for (const series of targetSeries) {
    let observations;
    try {
      observations = await fetchEiaWeeklyStocks({
        apiKey,
        seriesId: series.id,
        length,
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
      length,
      series_filter: seriesFilter ?? null,
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
