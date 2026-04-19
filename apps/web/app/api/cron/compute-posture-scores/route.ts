import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import seed from '@/lib/fixtures/posture_seed.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Compute-posture-scores · every 15 min.
 * For each pinned theatre, pulls last 30 min of aircraft, vessel,
 * conflict, and energy_flows rows within the theatre's bbox, composes
 * the five sub-scores, and writes a posture_scores row.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 60_000).toISOString();

  const results: Array<{ theatre: string; composite: number }> = [];

  for (const t of seed.theatres) {
    try {
      const { bbox } = t;
      if (!bbox) continue;

      const [airRes, seaRes, confRes, gridRes] = await Promise.all([
        supabase
          .from('aircraft_positions')
          .select('id', { count: 'exact', head: true })
          .gte('ingested_at', since)
          .gte('latitude', bbox.lat_min)
          .lte('latitude', bbox.lat_max)
          .gte('longitude', bbox.lon_min)
          .lte('longitude', bbox.lon_max),
        supabase
          .from('vessel_positions')
          .select('id', { count: 'exact', head: true })
          .gte('ingested_at', since)
          .gte('latitude', bbox.lat_min)
          .lte('latitude', bbox.lat_max)
          .gte('longitude', bbox.lon_min)
          .lte('longitude', bbox.lon_max),
        supabase
          .from('conflict_events')
          .select('id', { count: 'exact', head: true })
          .gte('ingested_at', since)
          .gte('latitude', bbox.lat_min)
          .lte('latitude', bbox.lat_max)
          .gte('longitude', bbox.lon_min)
          .lte('longitude', bbox.lon_max),
        supabase
          .from('energy_flows')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', since),
      ]);

      // Normalise each count against a loose per-theatre ceiling.
      const air = saturate((airRes.count ?? 0) / 40);
      const sea = saturate((seaRes.count ?? 0) / 50);
      const conflict = saturate((confRes.count ?? 0) / 6);
      const grid = saturate((gridRes.count ?? 0) / 30);
      const imagery = t.imagery ?? 0.3;
      const composite = round3(0.25 * air + 0.25 * sea + 0.25 * conflict + 0.15 * grid + 0.10 * imagery);

      await supabase.from('posture_scores').insert({
        theatre_slug: t.slug,
        composite,
        air, sea, conflict, grid, imagery,
        computed_at: now.toISOString(),
      });
      results.push({ theatre: t.slug, composite });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error(`compute-posture-scores failed for ${t.slug}:`, message);
    }
  }

  return NextResponse.json({ ok: true, computed: results, computed_at: now.toISOString() });
}

function saturate(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
