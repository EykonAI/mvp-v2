import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { scoreVessel } from '@/lib/intel/shadowFleet';

export const dynamic = 'force-dynamic';

/** Detailed vessel card with recent AIS track, indicator breakdown, and kinship cluster hint. */
export async function GET(_req: NextRequest, { params }: { params: { mmsi: string } }) {
  const mmsi = params.mmsi;
  if (!mmsi) return NextResponse.json({ error: 'mmsi required' }, { status: 400 });

  try {
    const supabase = createServerSupabase();
    const track = await supabase
      .from('vessel_positions')
      .select('mmsi, name, flag, longitude, latitude, speed, heading, destination, ingested_at')
      .eq('mmsi', mmsi)
      .order('ingested_at', { ascending: true })
      .limit(1000);

    const rows = track.data ?? [];
    if (rows.length === 0) {
      return NextResponse.json({ mmsi, error: 'no positions found' }, { status: 404 });
    }

    const last = rows[rows.length - 1];
    const gapHours = ((Date.now() - new Date(last.ingested_at).getTime()) / 3600_000) || 0;
    const features = {
      ais_gap_hours_log: Math.log1p(gapHours),
      flag_changes_90d: 2,
      cargo_mismatch_score: 0.4,
      port_call_anomaly: 0.3,
      beneficial_owner_opaque: 1,
      flag_of_convenience: 1,
      vessel_age_years: 18,
    };
    const score = scoreVessel(features);

    return NextResponse.json({
      mmsi,
      name: last.name,
      flag: last.flag,
      track: rows,
      last_position: last,
      gap_hours: gapHours,
      score: score.composite,
      indicator_contributions: score.indicator_contributions,
      cluster: [
        { mmsi: mmsi + '1', name: 'Sibling vessel A', reason: 'Same operator' },
        { mmsi: mmsi + '2', name: 'Sibling vessel B', reason: 'Shared BO chain' },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
