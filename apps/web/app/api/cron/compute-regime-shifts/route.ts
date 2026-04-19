import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import seed from '@/lib/fixtures/posture_seed.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Compute-regime-shifts · nightly.
 * Pairwise Mann-Whitney-style test on 60d vs 30d windows per signal
 * per pinned theatre. V1 uses a lightweight z-test on the means so
 * the migration does not require simple-statistics yet — upgrade to
 * Mann-Whitney once the dep is installed.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();

  const oldSince = new Date(now.getTime() - 90 * 24 * 3600_000).toISOString();
  const oldUntil = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
  const newSince = oldUntil;

  const writes: any[] = [];

  for (const t of seed.theatres) {
    const bbox = t.bbox;
    if (!bbox) continue;

    for (const [signal, table] of [
      ['vessel_count',  'vessel_positions']   as const,
      ['flight_count',  'aircraft_positions'] as const,
      ['acled_events',  'conflict_events']    as const,
    ]) {
      const [o, n] = await Promise.all([
        windowStats(supabase, table, bbox, oldSince, oldUntil),
        windowStats(supabase, table, bbox, newSince, now.toISOString()),
      ]);

      const effect_size = o.std > 0 ? (n.mean - o.mean) / o.std : 0;
      const z = Math.abs(effect_size);
      const p_value = Math.max(0.0001, Math.min(0.5, 2 * (1 - normCdf(z))));

      writes.push({
        region: t.slug,
        signal,
        test_statistic: round3(z),
        p_value: round3(p_value),
        effect_size: round3(effect_size),
        old_window: { start: oldSince, end: oldUntil, mean: o.mean, std: o.std, count: o.count },
        new_window: { start: newSince, end: now.toISOString(), mean: n.mean, std: n.std, count: n.count },
        detected_at: now.toISOString(),
      });
    }
  }

  if (writes.length > 0) {
    await supabase.from('regime_shifts').insert(writes);
  }

  return NextResponse.json({ ok: true, writes: writes.length });
}

async function windowStats(
  supabase: any,
  table: string,
  bbox: { lat_min: number; lat_max: number; lon_min: number; lon_max: number },
  fromIso: string,
  toIso: string,
): Promise<{ count: number; mean: number; std: number }> {
  // Pull counts per day then compute mean / std. 90 days is safe for a 5k limit.
  const { data } = await supabase
    .from(table)
    .select('ingested_at')
    .gte('ingested_at', fromIso)
    .lte('ingested_at', toIso)
    .gte('latitude', bbox.lat_min).lte('latitude', bbox.lat_max)
    .gte('longitude', bbox.lon_min).lte('longitude', bbox.lon_max)
    .limit(20_000);

  const perDay = new Map<string, number>();
  for (const r of data ?? []) {
    const d = new Date(r.ingested_at).toISOString().slice(0, 10);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const counts = Array.from(perDay.values());
  const mean = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  const std = counts.length
    ? Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length)
    : 0;
  return { count: counts.length, mean: round3(mean), std: round3(std) };
}

function normCdf(z: number): number {
  // Abramowitz & Stegun approx
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
