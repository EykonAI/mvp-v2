import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import seed from '@/lib/fixtures/posture_seed.json';
import { compositeFromDomains } from '@/lib/intel/postureComposite';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Compute-posture-scores · every 15 min.
 * For each pinned theatre, pulls last 30 min of aircraft, vessel,
 * conflict, and energy_flows rows within the theatre's bbox, composes
 * the four measured sub-scores, and writes a posture_scores row.
 *
 * There is no imagery sub-score. The fifth term this route used to add
 * was the fixture's constant, not an observation; it is written as NULL
 * until the Imagery Layer produces real ones. See lib/intel/postureComposite.ts.
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
          .gte('ingested_at', since),
      ]);

      // Normalise each count against a loose per-theatre ceiling.
      const air = saturate((airRes.count ?? 0) / 40);
      const sea = saturate((seaRes.count ?? 0) / 50);
      const conflict = saturate((confRes.count ?? 0) / 6);
      const grid = saturate((gridRes.count ?? 0) / 30);
      const composite = compositeFromDomains(air, sea, conflict, grid);

      const { error: insertError } = await supabase.from('posture_scores').insert({
        theatre_slug: t.slug,
        composite,
        air, sea, conflict, grid,
        imagery: null,
        computed_at: now.toISOString(),
      });
      // Fail loud: a tick that reports a composite it never stored is the
      // "ok:true having written nothing" failure (brief §0.2).
      if (insertError) throw new Error(`posture_scores insert: ${insertError.message}`);
      results.push({ theatre: t.slug, composite });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error(`compute-posture-scores failed for ${t.slug}:`, message);
    }
  }

  // `formula` echoes which composite this build computes, so a stale
  // deploy is visible from outside (brief §3.1).
  return NextResponse.json(
    {
      ok: results.length > 0,
      formula: 'four-domain-v2 (no imagery term)',
      computed: results,
      computed_at: now.toISOString(),
    },
    { status: results.length > 0 ? 200 : 500 },
  );
}

function saturate(x: number): number {
  return Math.max(0, Math.min(1, x));
}
