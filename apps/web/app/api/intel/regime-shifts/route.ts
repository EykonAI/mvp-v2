import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import seed from '@/lib/fixtures/posture_seed.json';

export const dynamic = 'force-dynamic';

/**
 * Fixed display order — the panel must read identically across
 * theatres, and the cron may insert in any order.
 */
const SIGNAL_ORDER = [
  'vessel_count',
  'flight_count',
  'acled_events',
  'thermal_detections',
  'nightlights_radiance',
];

/** slug → display label ("taiwan-strait" → "Taiwan Strait"). */
const LABELS = new Map<string, string>(seed.theatres.map(t => [t.slug, t.label] as [string, string]));

const DEMO = {
  regions: [
    {
      region: 'red-sea',
      label: 'Red Sea',
      detected: true,
      shifted: ['acled_events'],
      driving: 'acled_events',
      p_value: 0.0042,
      test_statistic: 0.38,
      old_window: { start: '2026-01-20', end: '2026-03-20', mean: 18, std: 4 },
      new_window: { start: '2026-03-21', end: '2026-04-19', mean: 27, std: 5 },
      signals: [
        { signal: 'vessel_count', effect: 0.54, direction: 'up',   p_value: 0.02,   thin: false, test: 'z' },
        { signal: 'flight_count', effect: 0.22, direction: 'up',   p_value: 0.31,   thin: false, test: 'z' },
        { signal: 'acled_events', effect: 0.61, direction: 'up',   p_value: 0.0042, thin: false, test: 'z' },
      ],
    },
    {
      region: 'black-sea',
      label: 'Black Sea',
      detected: true,
      shifted: ['flight_count', 'acled_events'],
      driving: 'acled_events',
      p_value: 0.0008,
      test_statistic: 0.52,
      old_window: { start: '2026-01-20', end: '2026-03-20', mean: 32, std: 6 },
      new_window: { start: '2026-03-21', end: '2026-04-19', mean: 58, std: 8 },
      signals: [
        { signal: 'vessel_count', effect: 0.31, direction: 'up', p_value: 0.09,   thin: false, test: 'z' },
        { signal: 'flight_count', effect: 0.78, direction: 'up', p_value: 0.006,  thin: false, test: 'z' },
        { signal: 'acled_events', effect: 0.82, direction: 'up', p_value: 0.0008, thin: false, test: 'z' },
      ],
    },
    {
      region: 'taiwan-strait',
      label: 'Taiwan Strait',
      detected: false,
      shifted: [],
      driving: 'flight_count',
      p_value: 0.18,
      test_statistic: 0.08,
      old_window: { start: '2026-01-20', end: '2026-03-20', mean: 41, std: 5 },
      new_window: { start: '2026-03-21', end: '2026-04-19', mean: 43, std: 6 },
      signals: [
        { signal: 'vessel_count', effect: 0.06, direction: 'flat', p_value: 0.72, thin: false, test: 'z' },
        { signal: 'flight_count', effect: 0.11, direction: 'up',   p_value: 0.18, thin: false, test: 'z' },
        { signal: 'acled_events', effect: 0.02, direction: 'flat', p_value: 0.91, thin: false, test: 'z' },
      ],
    },
  ],
  computed_at: null,
  degraded: true,
  note: 'Illustrative data — live rows appear after the next nightly compute-regime-shifts run.',
};

/**
 * Regime-shift summary reader.
 *
 * The cron writes one row per (theatre × signal) per night and never
 * prunes, so "latest 50 rows, append every signal" duplicated the
 * panel a little more each night. This reader keeps exactly ONE row
 * per (region, signal) — the newest — and computes every verdict from
 * that deduplicated set only, never from stale nights.
 */
export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    // 400 ≈ 6 theatres × 5 signals × ~13 nights of headroom; covered
    // by idx_regime_region_time.
    const { data, error } = await supabase
      .from('regime_shifts')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(400);

    if (error || !data || data.length === 0) {
      return NextResponse.json(DEMO);
    }

    // Newest-first, so the first row seen per (region, signal) wins.
    const latest = new Map<string, any>();
    for (const row of data) {
      const key = `${row.region}:${row.signal}`;
      if (!latest.has(key)) latest.set(key, row);
    }

    let computed_at: string | null = null;
    const regions = new Map<string, any>();
    for (const row of latest.values()) {
      if (!computed_at || row.detected_at > computed_at) computed_at = row.detected_at;

      const r = regions.get(row.region) ?? {
        region: row.region,
        label: LABELS.get(row.region) ?? row.region,
        detected: false,
        shifted: [] as string[],
        signals: [] as any[],
      };

      // p_value is NULL on thin windows (< 8 data days) — a null p can
      // never flag a shift.
      const p = row.p_value === null || row.p_value === undefined ? null : Number(row.p_value);
      if (p !== null && p < 0.01) {
        r.detected = true;
        r.shifted.push(row.signal);
      }

      const effect = Number(row.effect_size);
      r.signals.push({
        signal: row.signal,
        effect,
        direction: effect > 0.1 ? 'up' : effect < -0.1 ? 'down' : 'flat',
        p_value: p,
        test_statistic: row.test_statistic === null ? null : Number(row.test_statistic),
        // 'ks' rows carry a marker; rows from the pre-uplift z-test do
        // not — the UI must not label a z p-value as a KS p-value.
        test: row.new_window?.test === 'ks' ? 'ks' : 'z',
        thin: p === null,
        old_window: row.old_window,
        new_window: row.new_window,
      });
      regions.set(row.region, r);
    }

    const sigRank = (s: string) => {
      const i = SIGNAL_ORDER.indexOf(s);
      return i === -1 ? SIGNAL_ORDER.length : i;
    };
    for (const r of regions.values()) {
      r.signals.sort((a: any, b: any) => sigRank(a.signal) - sigRank(b.signal));
      r.shifted.sort((a: string, b: string) => sigRank(a) - sigRank(b));
      // The driving signal — lowest non-null p — anchors the region
      // headline and the default histogram selection.
      const scored = r.signals.filter((s: any) => s.p_value !== null);
      const driving = scored.length
        ? scored.reduce((m: any, s: any) => (s.p_value < m.p_value ? s : m))
        : r.signals[0];
      r.driving = driving?.signal ?? null;
      r.p_value = driving?.p_value ?? null;
      r.test_statistic = driving?.test_statistic ?? null;
      r.old_window = driving?.old_window ?? null;
      r.new_window = driving?.new_window ?? null;
    }

    // Stable theatre order = seed order.
    const theatreRank = new Map<string, number>(seed.theatres.map((t, i) => [t.slug, i] as [string, number]));
    const out = Array.from(regions.values()).sort(
      (a, b) => (theatreRank.get(a.region) ?? 99) - (theatreRank.get(b.region) ?? 99),
    );
    return NextResponse.json({ regions: out, computed_at, degraded: false });
  } catch {
    return NextResponse.json(DEMO);
  }
}
