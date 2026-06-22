import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { scoreVessel, computeRealFeatures } from '@/lib/intel/shadowFleet';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Only the recently-active fleet is "trackable". vessel_positions accumulates
// latest-per-MMSI, so a 30-day window is dominated by vessels that long ago
// left our AIS coverage — not dark-fleet, just gone. Scoring the recent window
// keeps the leads list to vessels we are actually tracking.
const ACTIVE_WINDOW_H = 72;
const UPSERT_BATCH = 1000;

/**
 * Compute-shadow-fleet-scores · hourly.
 *
 * v2 scores ONLY from signals the live AIS feed provides — the dark-gap (hours
 * since last fix, measured against the feed's freshest observation so a feed
 * outage doesn't flag everything) and flag-of-convenience. The v1 cargo /
 * port-call / beneficial-owner / flag-history / vessel-age features were
 * loop-index placeholders with no data source; they saturated the composite
 * near 1.0 (~95% of vessels flagged) and were removed. Restore them (here, in
 * computeRealFeatures, and the weights fixture) once the enrichment pipeline
 * lands.
 *
 * Profiles for vessels that have left the active window are pruned, so
 * vessel_profiles reflects the current tracked fleet with real scores only
 * (this also clears the legacy synthetic rows on the first run).
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const since = new Date(now.getTime() - ACTIVE_WINDOW_H * 3600_000).toISOString();

  const { data: positions, error } = await supabase
    .from('vessel_positions')
    .select('mmsi, name, flag, ingested_at')
    .gte('ingested_at', since)
    .order('ingested_at', { ascending: false })
    .limit(10_000);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!positions || positions.length === 0) {
    return NextResponse.json({ ok: true, scored: 0, note: 'no recent positions' });
  }

  // Data clock = freshest observation in the batch (rows are desc by
  // ingested_at). Gaps are measured against this, not wall-clock, so a stalled
  // feed doesn't flag every vessel as dark.
  const dataClock = new Date(positions[0].ingested_at).getTime();

  const latestByMmsi = new Map<string, any>();
  for (const p of positions) {
    if (!latestByMmsi.has(p.mmsi)) latestByMmsi.set(p.mmsi, p);
  }

  const upserts = Array.from(latestByMmsi.values()).map((p) => {
    const gapHours = Math.max(0, (dataClock - new Date(p.ingested_at).getTime()) / 3600_000);
    const features = computeRealFeatures({ flag: p.flag, gapHours });
    return {
      mmsi: p.mmsi,
      name: p.name,
      flag: p.flag,
      composite_score: scoreVessel(features).composite,
      indicators: features,
      last_ais_at: p.ingested_at,
      last_dark_at: gapHours > 6 ? p.ingested_at : null,
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
  // reflects the current tracked fleet (also clears the legacy synthetic rows).
  const { error: delErr } = await supabase
    .from('vessel_profiles')
    .delete()
    .lt('last_ais_at', since);

  return NextResponse.json({
    ok: true,
    scored: upserts.length,
    pruned: delErr ? `error: ${delErr.message}` : 'ok',
  });
}
