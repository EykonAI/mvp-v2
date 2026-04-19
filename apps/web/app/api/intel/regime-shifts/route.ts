import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const DEMO = {
  regions: [
    {
      region: 'Red Sea',
      detected: true,
      p_value: 0.0042,
      test_statistic: 0.38,
      old_window: { start: '2026-01-20', end: '2026-03-20', mean: 18, std: 4 },
      new_window: { start: '2026-03-21', end: '2026-04-19', mean: 27, std: 5 },
      signals: [
        { signal: 'vessel_count',   effect: 0.54, direction: 'up'   },
        { signal: 'flight_count',   effect: 0.22, direction: 'up'   },
        { signal: 'acled_events',   effect: 0.61, direction: 'up'   },
        { signal: 'energy_gen_mw',  effect: 0.08, direction: 'flat' },
      ],
    },
    {
      region: 'Black Sea',
      detected: true,
      p_value: 0.0008,
      test_statistic: 0.52,
      old_window: { start: '2026-01-20', end: '2026-03-20', mean: 32, std: 6 },
      new_window: { start: '2026-03-21', end: '2026-04-19', mean: 58, std: 8 },
      signals: [
        { signal: 'vessel_count',  effect: 0.31, direction: 'up'   },
        { signal: 'flight_count',  effect: 0.78, direction: 'up'   },
        { signal: 'acled_events',  effect: 0.82, direction: 'up'   },
        { signal: 'energy_gen_mw', effect: 0.44, direction: 'up'   },
      ],
    },
    {
      region: 'Taiwan Strait',
      detected: false,
      p_value: 0.18,
      test_statistic: 0.08,
      old_window: { start: '2026-01-20', end: '2026-03-20', mean: 41, std: 5 },
      new_window: { start: '2026-03-21', end: '2026-04-19', mean: 43, std: 6 },
      signals: [
        { signal: 'vessel_count',  effect: 0.06, direction: 'flat' },
        { signal: 'flight_count',  effect: 0.11, direction: 'up'   },
        { signal: 'acled_events',  effect: 0.02, direction: 'flat' },
        { signal: 'energy_gen_mw', effect: 0.04, direction: 'flat' },
      ],
    },
  ],
  degraded: true,
  note: 'Showing illustrative shifts until the nightly regime-shifts cron lands (Phase 7).',
};

/** Regime-shift summary reader. */
export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('regime_shifts')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return NextResponse.json(DEMO);
    }

    // Group by region; pick the most recent row per signal.
    const regions = new Map<string, any>();
    for (const row of data) {
      const r = regions.get(row.region) ?? { region: row.region, detected: false, signals: [] };
      if (row.p_value < 0.01) r.detected = true;
      if (!r.p_value || row.p_value < r.p_value) {
        r.p_value = Number(row.p_value);
        r.test_statistic = Number(row.test_statistic);
        r.old_window = row.old_window;
        r.new_window = row.new_window;
      }
      r.signals.push({
        signal: row.signal,
        effect: Number(row.effect_size),
        direction: row.effect_size > 0.1 ? 'up' : row.effect_size < -0.1 ? 'down' : 'flat',
      });
      regions.set(row.region, r);
    }
    return NextResponse.json({ regions: Array.from(regions.values()), degraded: false });
  } catch {
    return NextResponse.json(DEMO);
  }
}
