import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import seed from '@/lib/fixtures/posture_seed.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Compute-baselines · nightly.
 * Learns per-theatre baseline_distributions for the four core metrics
 * (vessel_count, aircraft_count, acled_events, energy_gen_mw) from
 * the last 14 days of data.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const since = new Date(now.getTime() - 14 * 24 * 3600_000).toISOString();

  const upserts: Array<any> = [];

  for (const t of seed.theatres) {
    const bbox = t.bbox;
    if (!bbox) continue;

    const [airRes, seaRes, confRes] = await Promise.all([
      supabase
        .from('aircraft_positions')
        .select('ingested_at')
        .gte('ingested_at', since)
        .gte('latitude', bbox.lat_min).lte('latitude', bbox.lat_max)
        .gte('longitude', bbox.lon_min).lte('longitude', bbox.lon_max)
        .limit(5000),
      supabase
        .from('vessel_positions')
        .select('ingested_at')
        .gte('ingested_at', since)
        .gte('latitude', bbox.lat_min).lte('latitude', bbox.lat_max)
        .gte('longitude', bbox.lon_min).lte('longitude', bbox.lon_max)
        .limit(5000),
      supabase
        .from('conflict_events')
        .select('ingested_at')
        .gte('ingested_at', since)
        .gte('latitude', bbox.lat_min).lte('latitude', bbox.lat_max)
        .gte('longitude', bbox.lon_min).lte('longitude', bbox.lon_max)
        .limit(5000),
    ]);

    for (const [metric, rows] of [
      ['aircraft_count', airRes.data ?? []],
      ['vessel_count',   seaRes.data ?? []],
      ['acled_events',   confRes.data ?? []],
    ] as Array<[string, Array<{ ingested_at: string }>]>) {
      const buckets = bucketByHourOfWeek(rows);
      const mean = buckets.reduce((a, b) => a + b, 0) / Math.max(1, buckets.length);
      const std = Math.sqrt(buckets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, buckets.length));
      upserts.push({
        entity_class: 'theatre',
        entity_key: t.slug,
        metric,
        distribution: { mean, std, hour_of_week: buckets },
        sample_size: rows.length,
        learned_at: now.toISOString(),
      });
    }
  }

  if (upserts.length > 0) {
    await supabase.from('baseline_distributions').upsert(upserts, { onConflict: 'entity_class,entity_key,metric' });
  }

  return NextResponse.json({ ok: true, upserts: upserts.length, computed_at: now.toISOString() });
}

function bucketByHourOfWeek(rows: Array<{ ingested_at: string }>): number[] {
  const buckets = Array.from({ length: 24 * 7 }, () => 0);
  for (const r of rows) {
    const d = new Date(r.ingested_at);
    const idx = d.getUTCDay() * 24 + d.getUTCHours();
    buckets[idx]++;
  }
  return buckets;
}
