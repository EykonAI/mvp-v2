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
  // liveness, never on the count value. NB this comment used to end "a genuine
  // zero on a live feed still writes" — that premise was FALSE and is corrected
  // by the per-box guard below.
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

  // Per-box liveness guard (2026-09-07, migration 131).
  //
  // The guard above asks whether the FEED is alive. Necessary, not sufficient:
  // coverage is PER BOX, and a box can be dark for weeks while the feed as a
  // whole runs at ~430k positions/day. On 2026-08-18 suez wrote vessel_count 0
  // while malacca and bosphorus reported normally — the feed was live, that box
  // was not. Migration 131 withdrew 30 such rows, and 16 were exactly this
  // shape: one box reading zero while its siblings reported, including
  // FOURTEEN consecutive malacca days.
  //
  // A zero on a live feed can mean THIS BOX HAS NO COVERAGE. Malacca, Suez and
  // Bosphorus are never empty of vessels over 24 hours, so such a zero is never
  // an observation.
  const { data: boxRows, error: boxErr } = await supabase
    .from('ais_box_liveness')
    .select('slug, newest_fix, computed_at')
    .in('slug', SNAPSHOT_CHOKEPOINTS as string[]);

  // GUARD THE GUARD. Every ais_box_liveness row is written by ONE refresher
  // pass, so computed_at is uniform across the table — and if that refresher
  // dies, newest_fix FREEZES and this check would certify a dead box as live
  // from yesterday's numbers. A staleness check whose own source can go stale
  // is not a check. If it is stale, per-box liveness cannot be established at
  // all, so we write nothing and fail loud, exactly as the feed guard does.
  const guardComputedAt = boxRows?.[0]?.computed_at ? new Date(boxRows[0].computed_at) : null;
  const guardAgeHours = guardComputedAt
    ? (Date.now() - guardComputedAt.getTime()) / 3600_000
    : null;

  if (boxErr || !boxRows?.length || guardAgeHours === null || guardAgeHours > SNAPSHOT_WINDOW_HOURS) {
    return NextResponse.json(
      {
        ok: false,
        error: 'box_liveness_unavailable',
        detail: boxErr
          ? `ais_box_liveness probe failed: ${boxErr.message}`
          : !boxRows?.length
            ? 'ais_box_liveness returned no rows for the snapshot slugs — per-box liveness cannot be established'
            : `ais_box_liveness is itself ${guardAgeHours === null ? 'undated' : `${guardAgeHours.toFixed(1)}h`} stale (window ${SNAPSHOT_WINDOW_HOURS}h) — the guard cannot be trusted, no rows written`,
        period,
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }

  const boxSilenceHours = new Map<string, number | null>(
    boxRows.map((b) => [
      b.slug as string,
      b.newest_fix ? (Date.now() - new Date(b.newest_fix as string).getTime()) / 3600_000 : null,
    ]),
  );

  const results: Array<{
    chokepoint: string;
    vessel_count: number | null;
    error?: string;
  }> = [];
  const skipped: Array<{
    chokepoint: string;
    reason: string;
    box_silent_hours: number | null;
  }> = [];

  for (const slug of SNAPSHOT_CHOKEPOINTS) {
    // An absent row and a stale row are the SAME answer — we cannot show this
    // box was observed, so no row is written. That is the coverage invariant
    // the table exists to obey: a row exists iff we looked.
    const silence = boxSilenceHours.has(slug) ? boxSilenceHours.get(slug)! : null;
    if (silence === null || silence > SNAPSHOT_WINDOW_HOURS) {
      skipped.push({
        chokepoint: slug,
        reason: boxSilenceHours.has(slug) ? 'box_stale' : 'no_liveness_row',
        box_silent_hours: silence === null ? null : Number(silence.toFixed(1)),
      });
      continue;
    }

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
  const wrote = results.filter((r) => !r.error).length;

  // A SKIPPED BOX MUST NOT MAKE THIS CRON PERMANENTLY RED. Bab-el-Mandeb has
  // been dark since 2026-07-18 and Hormuz is intermittent; if one dark box
  // failed the run, this cron would be red every day forever and stop carrying
  // information — a gate that is always red is not a gate (brief §13.2.3).
  // Skips are REPORTED, per box with the silence that caused them, and the run
  // stays green while at least one box was genuinely observed.
  //
  // EVERY box skipped is a different situation: the feed reports live yet no
  // box does. That is not a coverage hole, it is a contradiction, and it fails
  // loud.
  if (wrote === 0 && failed === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'all_boxes_stale',
        detail:
          'the feed reports live but every snapshot box is stale — no box could be observed, so no rows were written',
        period,
        skipped,
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      ok: failed === 0,
      period,
      chokepoints: results,
      // Always present, even when empty: a caller must be able to tell
      // "every box reported" from "some boxes were never looked at".
      skipped,
      written: wrote,
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
