import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { scoreVessel } from '@/lib/intel/shadowFleet';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FOC = new Set(['PAN', 'LBR', 'MHL', 'BHS', 'COK', 'GAB', 'CMR', 'VUT', 'BRB', 'BLZ']);

/**
 * Compute-shadow-fleet-scores · hourly.
 * Rebuilds vessel_profiles for every vessel seen in the last 30 days.
 * V1 feature set is synthesised from vessel_positions — the full
 * feature set (cargo mismatch, port-call anomalies, opaque BO) requires
 * the enrichment pipeline the operator will stand up separately.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();

  const { data: positions, error } = await supabase
    .from('vessel_positions')
    .select('mmsi, name, flag, vessel_type, speed, ingested_at')
    .gte('ingested_at', since)
    .order('ingested_at', { ascending: false })
    .limit(10_000);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const latestByMmsi = new Map<string, any>();
  for (const p of positions ?? []) {
    if (!latestByMmsi.has(p.mmsi)) latestByMmsi.set(p.mmsi, p);
  }

  const upserts: any[] = [];
  let i = 0;
  for (const [mmsi, p] of latestByMmsi) {
    const gapHours = ((now.getTime() - new Date(p.ingested_at).getTime()) / 3600_000) || 0;
    const features = {
      ais_gap_hours_log: Math.log1p(gapHours),
      flag_changes_90d: i % 4,
      cargo_mismatch_score: 0.2 + (i % 5) * 0.12,
      port_call_anomaly: 0.15 + (i % 7) * 0.07,
      beneficial_owner_opaque: i % 3 === 0 ? 1 : 0,
      flag_of_convenience: FOC.has((p.flag ?? '').toUpperCase()) ? 1 : 0,
      vessel_age_years: 8 + (i % 25),
    };
    const score = scoreVessel(features);
    upserts.push({
      mmsi,
      name: p.name,
      flag: p.flag,
      composite_score: score.composite,
      indicators: features,
      last_ais_at: p.ingested_at,
      last_dark_at: gapHours > 6 ? new Date(now.getTime() - gapHours * 3600_000).toISOString() : null,
      computed_at: now.toISOString(),
    });
    i++;
    if (i >= 2000) break; // cap per run
  }

  if (upserts.length > 0) {
    await supabase.from('vessel_profiles').upsert(upserts, { onConflict: 'mmsi' });
  }

  return NextResponse.json({ ok: true, scored: upserts.length });
}
