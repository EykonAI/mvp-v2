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

    for (const spec of SIGNALS) {
      const [o, n] = await Promise.all([
        spec.kind === 'nightlights_radiance'
          ? nightlightsRadianceStats(supabase, bbox, oldSince, oldUntil)
          : windowStats(supabase, spec.table!, bbox, oldSince, oldUntil),
        spec.kind === 'nightlights_radiance'
          ? nightlightsRadianceStats(supabase, bbox, newSince, now.toISOString())
          : windowStats(supabase, spec.table!, bbox, newSince, now.toISOString()),
      ]);
      const signal = spec.signal;

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

  let inserted = 0;
  if (writes.length > 0) {
    const { error } = await supabase.from('regime_shifts').insert(writes);
    if (error) {
      // Surface the failure instead of returning ok with 0 rows written — an
      // unchecked insert here is exactly how a column/schema fault could leave
      // regime_shifts empty while the cron reported success.
      return NextResponse.json(
        { ok: false, error: error.message, attempted: writes.length },
        { status: 500 },
      );
    }
    inserted = writes.length;
  }

  return NextResponse.json({ ok: true, inserted });
}


/**
 * Signals the detector watches per theatre.
 *
 * The three original signals are COUNTS of rows arriving in a feed. The
 * two sensor signals are deliberately different in kind:
 *
 *  • thermal_detections reads RAW firms_thermal_anomalies, not
 *    firms_significant_events. Counting our own significance output
 *    would be circular — it depends on baselines we chose. A hot-pixel
 *    count is a physical measurement.
 *  • nightlights_radiance is a MEAN OF A VALUE, not a count. Counting
 *    radiance rows would just count how many facilities we sampled,
 *    which is constant by construction. "This region got dimmer" is the
 *    regime shift; the number of observations is not.
 */
interface SignalSpec {
  signal: string;
  /** Table for the generic count-per-day path. */
  table?: string;
  /** Non-count signals that need their own query. */
  kind?: 'nightlights_radiance';
}

const SIGNALS: ReadonlyArray<SignalSpec> = [
  { signal: 'vessel_count',       table: 'vessel_positions' },
  { signal: 'flight_count',       table: 'aircraft_positions' },
  { signal: 'acled_events',       table: 'conflict_events' },
  // Raw hot pixels. firms_thermal_anomalies already carries latitude,
  // longitude and ingested_at, so it drops straight into windowStats.
  { signal: 'thermal_detections', table: 'firms_thermal_anomalies' },
  { signal: 'nightlights_radiance', kind: 'nightlights_radiance' },
];

/**
 * Mean clear-night radiance per night inside the bbox, via the
 * migration-096 RPC.
 *
 * Aggregated in the database, not in JS: the naive lat/lon BETWEEN join
 * measured 695 ms per window on prod (seq scan over power_plants), while
 * ST_Intersects against the geography GiST indexes plus a GROUP BY
 * returns ~30 rows in 77 ms. The cron issues two of these per theatre,
 * so the difference compounds.
 *
 * Returns the same {count, mean, std} contract as windowStats, but over
 * NIGHTLY MEAN RADIANCE rather than per-day row counts — so a downward
 * effect_size here means the region dimmed, not that fewer rows arrived.
 */
async function nightlightsRadianceStats(
  supabase: any,
  bbox: { lat_min: number; lat_max: number; lon_min: number; lon_max: number },
  fromIso: string,
  toIso: string,
): Promise<{ count: number; mean: number; std: number }> {
  const { data, error } = await supabase.rpc('nightlights_bbox_nightly_radiance', {
    p_lat_min: bbox.lat_min,
    p_lat_max: bbox.lat_max,
    p_lon_min: bbox.lon_min,
    p_lon_max: bbox.lon_max,
    p_from: fromIso.slice(0, 10),
    p_to: toIso.slice(0, 10),
  });
  // Fail soft to an empty window rather than throwing: one signal
  // erroring must not cost the other four for every theatre. An empty
  // window yields effect_size 0, which reads as "no shift detected" —
  // and count:0 in the stored window makes the thinness visible.
  if (error || !data) return { count: 0, mean: 0, std: 0 };

  const nightly = (data as Array<{ mean_radiance: number | string }>)
    .map(r => Number(r.mean_radiance))
    .filter(v => Number.isFinite(v));
  if (nightly.length === 0) return { count: 0, mean: 0, std: 0 };

  const mean = nightly.reduce((a, b) => a + b, 0) / nightly.length;
  const std = Math.sqrt(
    nightly.reduce((a, b) => a + (b - mean) ** 2, 0) / nightly.length,
  );
  return { count: nightly.length, mean: round3(mean), std: round3(std) };
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
