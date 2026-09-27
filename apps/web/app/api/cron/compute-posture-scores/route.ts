import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import seed from '@/lib/fixtures/posture_seed.json';
import { compositeFromDomains, compositeWithImagery, FORMULA_FIVE_DOMAIN, FORMULA_FOUR_DOMAIN } from '@/lib/intel/postureComposite';

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

  const results: Array<{ theatre: string; composite: number; formula: string; imagery: number | null; imagery_sites: number }> = [];
  const imageryErrors: string[] = [];

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
      // IMG-8: the imagery term exists only where admitted Sentinel-1 sites
      // inside the theatre had a clear, baselined look in the last 14 days
      // (imagery_theatre_term, mig 191). Otherwise NULL and four domains —
      // absence of a look is not a zero.
      let imagery: number | null = null;
      let imagerySites = 0;
      const { data: term, error: termErr } = await supabase.rpc('imagery_theatre_term', {
        p_lat_min: bbox.lat_min, p_lat_max: bbox.lat_max, p_lon_min: bbox.lon_min, p_lon_max: bbox.lon_max, p_days: 14,
      });
      if (termErr) imageryErrors.push(`${t.slug}: ${termErr.message}`);
      else {
        const row = (term as Array<{ sites_seen: number; share: number | null }> | null)?.[0];
        imagerySites = Number(row?.sites_seen ?? 0);
        if (row && row.share !== null && Number.isFinite(Number(row.share)) && imagerySites > 0) imagery = Number(row.share);
      }
      const formula = imagery === null ? FORMULA_FOUR_DOMAIN : FORMULA_FIVE_DOMAIN;
      const composite = imagery === null
        ? compositeFromDomains(air, sea, conflict, grid)
        : compositeWithImagery(air, sea, conflict, grid, imagery);

      const { error: insertError } = await supabase.from('posture_scores').insert({
        theatre_slug: t.slug,
        composite,
        air, sea, conflict, grid,
        imagery,
        composite_formula: formula,
        computed_at: now.toISOString(),
      });
      // Fail loud: a tick that reports a composite it never stored is the
      // "ok:true having written nothing" failure (brief §0.2).
      if (insertError) throw new Error(`posture_scores insert: ${insertError.message}`);
      results.push({ theatre: t.slug, composite, formula, imagery, imagery_sites: imagerySites });
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
      formula: 'four-domain-v2; five-domain-v3 only where admitted Sentinel-1 sites had a clear look (IMG-8)',
      imagery_errors: imageryErrors,
      computed: results,
      computed_at: now.toISOString(),
    },
    { status: results.length > 0 ? 200 : 500 },
  );
}

function saturate(x: number): number {
  return Math.max(0, Math.min(1, x));
}
