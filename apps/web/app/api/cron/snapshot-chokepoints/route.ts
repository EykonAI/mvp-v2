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

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
