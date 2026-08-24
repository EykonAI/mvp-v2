import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Per-vessel observed track — the real fixes we hold for one vessel over the
 * last 14 days, from ais_position_history, plus the current snapshot.
 *
 * Powers the board's cadence timeline (every tick a real fix) and the map's
 * track tail. Nothing is interpolated: a smooth line between sparse fixes
 * would be a fabrication indistinguishable from data, so consumers get the
 * points and draw the points.
 */
export async function GET(req: NextRequest) {
  const mmsi = new URL(req.url).searchParams.get('mmsi');
  if (!mmsi) return NextResponse.json({ error: 'mmsi query parameter required' }, { status: 200 });

  try {
    const supabase = createServerSupabase();
    const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();

    const [hist, pos] = await Promise.all([
      supabase
        .from('ais_position_history')
        .select('recorded_at, latitude, longitude, speed')
        .eq('mmsi', mmsi)
        .gte('recorded_at', since)
        .order('recorded_at', { ascending: true })
        .limit(1000),
      supabase
        .from('vessel_positions')
        .select('latitude, longitude, speed, heading, updated_at')
        .eq('mmsi', mmsi)
        .maybeSingle(),
    ]);

    return NextResponse.json({
      mmsi,
      fixes: hist.data ?? [],
      current: pos.data ?? null,
      window_days: 14,
      note: 'Real observed fixes only — never interpolated.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ mmsi, fixes: [], error: message }, { status: 200 });
  }
}
