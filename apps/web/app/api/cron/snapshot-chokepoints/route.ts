import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import {
  SNAPSHOT_CHOKEPOINTS,
  snapshotChokepoint,
} from '@/lib/chokepoints/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Chokepoint vessel-count snapshot · daily.
 *
 * For each slug in SNAPSHOT_CHOKEPOINTS, calls count_chokepoint_vessels
 * (migration 043 RPC) and upserts a row into
 * ais_chokepoint_observations keyed by (chokepoint, period).
 *
 * Period is today's UTC date. Re-runs on the same UTC day overwrite
 * vessel_count and snapshot_at — no duplicate row. After UTC midnight
 * the next run lands a new period row.
 *
 * Recommended Railway schedule: `30 0 * * *` (00:30 UTC daily — just
 * after UTC midnight so the new-period row lands first thing). Takes
 * a few seconds; maxDuration 60 is overkill but matches the rest of
 * the cron fleet.
 */
async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const startedAt = Date.now();
  const supabase = createServerSupabase();
  const period = todayUtcYmd();
  const snapshotAt = new Date().toISOString();

  // Feed-liveness guard (2026-08-09). The AIS worker died on 2026-08-05
  // and this cron kept counting an empty table, writing vessel_count 0
  // for every corridor — real-looking rows that rendered as "−100% vs
  // 14d avg" and poisoned the trailing baseline. A row in
  // ais_chokepoint_observations must mean "we looked with a live
  // instrument": if the newest vessel position is older than the count
  // window, we did not look, so we write NOTHING and fail loud (red
  // Railway run) instead of recording zeros. The guard keys on feed
  // liveness, never on the count value — a genuine zero on a live feed
  // still writes.
  const { data: newest, error: liveErr } = await supabase
    .from('vessel_positions')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  const newestAt = !liveErr && newest?.[0]?.updated_at ? new Date(newest[0].updated_at) : null;
  const feedAgeHours = newestAt
    ? (Date.now() - newestAt.getTime()) / 3600_000
    : null;

  if (liveErr || feedAgeHours === null || feedAgeHours > SNAPSHOT_WINDOW_HOURS) {
    return NextResponse.json(
      {
        ok: false,
        error: 'ais_feed_stale',
        detail: liveErr
          ? `liveness probe failed: ${liveErr.message}`
          : `newest vessel position is ${feedAgeHours === null ? 'absent' : `${feedAgeHours.toFixed(1)}h old`} (window ${SNAPSHOT_WINDOW_HOURS}h) — no rows written`,
        newest_position_at: newestAt?.toISOString() ?? null,
        period,
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }

  const results: Array<{
    chokepoint: string;
    vessel_count: number | null;
    error?: string;
  }> = [];

  for (const slug of SNAPSHOT_CHOKEPOINTS) {
    const snap = await snapshotChokepoint(supabase, slug);
    if (!snap) {
      results.push({ chokepoint: slug, vessel_count: null, error: 'rpc_failed' });
      continue;
    }

    const { error } = await supabase
      .from('ais_chokepoint_observations')
      .upsert(
        {
          chokepoint: snap.chokepoint,
          period,
          vessel_count: snap.vessel_count,
          window_hours: snap.window_hours,
          snapshot_at: snapshotAt,
        },
        { onConflict: 'chokepoint,period' },
      );

    if (error) {
      results.push({
        chokepoint: slug,
        vessel_count: snap.vessel_count,
        error: `upsert: ${error.message}`,
      });
    } else {
      results.push({ chokepoint: slug, vessel_count: snap.vessel_count });
    }
  }

  const failed = results.filter((r) => r.error).length;
  return NextResponse.json(
    {
      ok: failed === 0,
      period,
      chokepoints: results,
      elapsed_ms: Date.now() - startedAt,
    },
    { status: failed === 0 ? 200 : 500 },
  );
}

// Must match the default windowHours passed to snapshotChokepoint —
// the liveness guard asks "could a count over this window possibly
// have seen a live feed?".
const SNAPSHOT_WINDOW_HOURS = 24;

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
