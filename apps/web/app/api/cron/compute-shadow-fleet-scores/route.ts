import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { scoreVessel, computeRealFeatures } from '@/lib/intel/shadowFleet';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Only the recently-active fleet is "trackable". vessel_positions accumulates
// latest-per-MMSI, so a wide window is dominated by vessels that long ago left
// our AIS coverage — not dark-fleet, just gone. Scoring the recent window keeps
// the leads list to vessels we are actually tracking.
//
// ACTIVE WINDOW IS MEASURED ON `updated_at` — see the timestamp note below.
// That is what bounds the maximum achievable gap to ACTIVE_WINDOW_H and what
// keeps vessels stranded in a dead coverage box out of the scored set: if a
// box has produced no fix for weeks, nothing from it is inside this window.
const ACTIVE_WINDOW_H = 72;
const UPSERT_BATCH = 1000;
const PAGE = 1000;
const MAX_SCAN = 60_000; // bounded, and reported — never silently truncated

/**
 * Compute-shadow-fleet-scores · hourly.
 *
 * THE TIMESTAMP THAT MATTERS
 * vessel_positions carries two timestamps that look interchangeable and are not:
 *   ingested_at — column DEFAULT now(), written once on INSERT. It is the age of
 *                 the ROW: the first time this vessel was ever seen. Never updated.
 *   updated_at  — maintained by trigger trg_vessel_touch on every upsert. It is
 *                 the last time the VESSEL transmitted.
 * This job scored the dark-gap from `ingested_at` until 2026-08-24, so the
 * composite measured how long a database row had existed rather than how long a
 * ship had been silent. Vessels under way at 12+ knots ranked top of the leads
 * list with a fabricated 52-hour gap. Everything here reads `updated_at`.
 *
 * v2 scores ONLY from signals the live AIS feed provides — the dark-gap and
 * flag-of-convenience. The v1 cargo / port-call / beneficial-owner / flag-history
 * / vessel-age features were loop-index placeholders with no data source; they
 * saturated the composite near 1.0 (~95% of vessels flagged) and were removed.
 * Restore them (here, in computeRealFeatures, and the weights fixture) once the
 * enrichment pipeline lands.
 *
 * NOT IN SCOPE HERE: coverage. A gap is still scored without asking whether the
 * box the vessel was last seen in was alive to observe it. The active window
 * makes that safe for the leads list today (a dead box drops out of it within
 * ACTIVE_WINDOW_H) but it is not a guarantee, and no dark-gap CLAIM may be
 * issued from these scores until the per-box liveness gate lands.
 *
 * Profiles for vessels that have left the active window are pruned, so
 * vessel_profiles reflects the current tracked fleet with real scores only.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const since = new Date(now.getTime() - ACTIVE_WINDOW_H * 3600_000).toISOString();

  // Data clock = the fleet-wide freshest observation, so a stalled feed doesn't
  // mark every vessel dark. Read explicitly rather than taken from the batch:
  // the batch is ordered oldest-first so that the silent vessels — the ones this
  // job exists to find — survive the scan cap.
  const clock = await supabase
    .from('vessel_positions')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const dataClockMs = clock.data?.updated_at
    ? new Date(clock.data.updated_at).getTime()
    : now.getTime();

  // Page through the active window, oldest fix first.
  const rows: Array<{ mmsi: string; name: string | null; flag: string | null; updated_at: string }> = [];
  let truncated = false;
  for (let from = 0; from < MAX_SCAN; from += PAGE) {
    const { data, error } = await supabase
      .from('vessel_positions')
      .select('mmsi, name, flag, updated_at')
      .gte('updated_at', since)
      .order('updated_at', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...(data as any));
    if (data.length < PAGE) break;
    if (rows.length >= MAX_SCAN) { truncated = true; break; }
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scored: 0, note: 'no positions in active window' });
  }

  const latestByMmsi = new Map<string, any>();
  for (const p of rows) latestByMmsi.set(p.mmsi, p);

  const upserts = Array.from(latestByMmsi.values()).map((p) => {
    const gapHours = Math.max(0, (dataClockMs - new Date(p.updated_at).getTime()) / 3600_000);
    const features = computeRealFeatures({ flag: p.flag, gapHours });
    return {
      mmsi: p.mmsi,
      name: p.name,
      flag: p.flag,
      composite_score: scoreVessel(features).composite,
      indicators: features,
      last_ais_at: p.updated_at,
      last_dark_at: gapHours > 6 ? p.updated_at : null,
      computed_at: now.toISOString(),
    };
  });

  for (let i = 0; i < upserts.length; i += UPSERT_BATCH) {
    const { error: upErr } = await supabase
      .from('vessel_profiles')
      .upsert(upserts.slice(i, i + UPSERT_BATCH), { onConflict: 'mmsi' });
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message, scored: i }, { status: 500 });
  }

  // Prune profiles for vessels that have left the active window so the table
  // reflects the current tracked fleet. last_ais_at now holds a true last-contact
  // time, so this prunes on the same clock the scores were computed against.
  const { error: delErr } = await supabase
    .from('vessel_profiles')
    .delete()
    .lt('last_ais_at', since);

  // Echo the inputs so a stale build is detectable from outside: `gap_source`
  // does not exist in any bundle before this change.
  return NextResponse.json({
    ok: true,
    gap_source: 'updated_at',
    active_window_h: ACTIVE_WINDOW_H,
    data_clock: new Date(dataClockMs).toISOString(),
    scanned: rows.length,
    truncated,
    scored: upserts.length,
    pruned: delErr ? `error: ${delErr.message}` : 'ok',
  });
}
