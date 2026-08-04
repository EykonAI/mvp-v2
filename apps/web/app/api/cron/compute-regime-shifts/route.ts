import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { ksStatistic, ksPValue, type DailyPoint } from '@/lib/intel/ks';
import seed from '@/lib/fixtures/posture_seed.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Compute-regime-shifts · nightly.
 * Two-sample Kolmogorov-Smirnov test on the trailing 30d vs the
 * preceding 60d (days 90→30 ago) of DAILY values, per signal per
 * pinned theatre. The daily arrays are persisted inside the window
 * JSONB so the workspace renders the distributions the test actually
 * compared. effect_size stays the standardized mean difference — it
 * carries direction/magnitude for display; the KS p carries
 * significance. They answer different questions.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();

  const oldSince = new Date(now.getTime() - 90 * 24 * 3600_000).toISOString();
  const oldUntil = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
  const newSince = oldUntil;

  // FEED ONSET, per count-signal table: the first ingested row's date.
  // A day BEFORE a feed existed is an absent look, never a zero — the
  // first real run flagged SHIFT on all six theatres at once because
  // 38 of the old window's 60 days predate the ADS-B feed (2026-06-13)
  // and the whole old window predates FIRMS ingest (2026-07-18); the KS
  // was truthfully detecting the sensors being switched on. Days before
  // onset are excluded from zero-fill; an old window left with < 8 real
  // days lands in the thin gate and cannot flag. Known residual: a feed
  // OUTAGE mid-window (e.g. the July AIS cert failure) still reads as
  // zeros — distinguishing "live and quiet" from "down" needs the
  // mig-089 liveness history and is deliberately not guessed at here.
  // Measured: worst onset probe (conflict_events, no ingested_at index)
  // is a 93 ms top-1 seq scan, once per signal per nightly run.
  const onsets = new Map<string, string | null>();
  for (const spec of SIGNALS) {
    if (!spec.table) continue;
    const { data } = await supabase
      .from(spec.table)
      .select('ingested_at')
      .order('ingested_at', { ascending: true })
      .limit(1);
    onsets.set(spec.table, data?.[0]?.ingested_at ? String(data[0].ingested_at).slice(0, 10) : null);
  }

  const writes: any[] = [];

  for (const t of seed.theatres) {
    const bbox = t.bbox;
    if (!bbox) continue;

    for (const spec of SIGNALS) {
      const onset = spec.table ? onsets.get(spec.table) ?? null : null;
      const [o, n] = await Promise.all([
        spec.kind === 'nightlights_radiance'
          ? nightlightsRadianceStats(supabase, bbox, oldSince, oldUntil)
          : windowStats(supabase, spec.table!, bbox, oldSince, oldUntil, onset),
        spec.kind === 'nightlights_radiance'
          ? nightlightsRadianceStats(supabase, bbox, newSince, now.toISOString())
          : windowStats(supabase, spec.table!, bbox, newSince, now.toISOString(), onset),
      ]);
      const signal = spec.signal;

      const effect_size = o.std > 0 ? (n.mean - o.mean) / o.std : 0;

      // KS needs enough days on both sides to compare distributions at
      // all — below 8, a null p that can never flag a shift is the
      // honest output, and the row says why.
      let test_statistic: number | null = null;
      let p_value: number | null = null;
      let reason: string | undefined;
      if (o.daily.length >= 8 && n.daily.length >= 8) {
        const D = ksStatistic(o.daily.map(x => x.v), n.daily.map(x => x.v));
        test_statistic = round3(D);
        p_value = round4(ksPValue(D, o.daily.length, n.daily.length));
      } else {
        reason = 'thin-window';
      }

      writes.push({
        region: t.slug,
        signal,
        test_statistic,
        p_value,
        effect_size: round3(effect_size),
        old_window: { start: oldSince, end: oldUntil, mean: o.mean, std: o.std, count: o.count, daily: o.daily },
        new_window: {
          start: newSince, end: now.toISOString(), mean: n.mean, std: n.std, count: n.count, daily: n.daily,
          test: 'ks',
          ...(reason ? { reason } : {}),
        },
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
 * Returns the same {count, mean, std, daily} contract as windowStats,
 * but over NIGHTLY MEAN RADIANCE rather than per-day row counts — so a
 * downward effect_size here means the region dimmed, not that fewer
 * rows arrived. Nights are NOT zero-filled: an absent night is an
 * absent LOOK (cloud, no clear pixel, NASA not yet published), never
 * darkness — the exact opposite of the count signals, where an empty
 * day is a real zero. That asymmetry is the honesty invariant.
 */
async function nightlightsRadianceStats(
  supabase: any,
  bbox: { lat_min: number; lat_max: number; lon_min: number; lon_max: number },
  fromIso: string,
  toIso: string,
): Promise<{ count: number; mean: number; std: number; daily: DailyPoint[] }> {
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
  // window has too few days for KS, so it lands in the thin-window
  // gate and can never fake a shift.
  if (error || !data) return { count: 0, mean: 0, std: 0, daily: [] };

  const daily = (data as Array<{ period: string; mean_radiance: number | string }>)
    .map(r => ({ d: String(r.period).slice(0, 10), v: Number(r.mean_radiance) }))
    .filter(p => Number.isFinite(p.v))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  if (daily.length === 0) return { count: 0, mean: 0, std: 0, daily: [] };

  const values = daily.map(p => p.v);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { count: daily.length, mean: round3(mean), std: round3(std), daily };
}

async function windowStats(
  supabase: any,
  table: string,
  bbox: { lat_min: number; lat_max: number; lon_min: number; lon_max: number },
  fromIso: string,
  toIso: string,
  onset: string | null,
): Promise<{ count: number; mean: number; std: number; daily: DailyPoint[] }> {
  const { data } = await supabase
    .from(table)
    .select('ingested_at')
    .gte('ingested_at', fromIso)
    .lte('ingested_at', toIso)
    .gte('latitude', bbox.lat_min).lte('latitude', bbox.lat_max)
    .gte('longitude', bbox.lon_min).lte('longitude', bbox.lon_max)
    .limit(20_000);

  // Zero-fill the day range, but only from FEED ONSET onward: while the
  // feed is live, a day with no rows in the bbox is a real observed
  // zero — leaving it out would bias the mean upward and blind the test
  // to quiet periods. Days before the feed's first row are absent
  // looks and are excluded entirely (see the onset comment in POST).
  // The current UTC day is excluded everywhere: it is partial and would
  // read as a false collapse. An empty onset (empty table) yields no
  // days at all → thin gate.
  const perDay = new Map<string, number>();
  if (onset !== null) {
    for (const d of utcDays(fromIso, toIso)) {
      if (d >= onset) perDay.set(d, 0);
    }
  }
  for (const r of data ?? []) {
    const d = new Date(r.ingested_at).toISOString().slice(0, 10);
    if (perDay.has(d)) perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const daily = Array.from(perDay, ([d, v]) => ({ d, v }));
  const counts = daily.map(p => p.v);
  const mean = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  const std = counts.length
    ? Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length)
    : 0;
  return { count: counts.length, mean: round3(mean), std: round3(std), daily };
}

/** UTC dates in [from, to), additionally excluding the partial current day. */
function utcDays(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const end = Date.parse(toIso.slice(0, 10) + 'T00:00:00Z');
  for (let t = Date.parse(fromIso.slice(0, 10) + 'T00:00:00Z'); t < end; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d >= today) break;
    out.push(d);
  }
  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
