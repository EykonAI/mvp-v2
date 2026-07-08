import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { EIA_CUSHING_CRUDE_STOCKS } from '@/lib/eia/client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Commodities workspace — live inputs (INTEL grounding audit 2026-07-04,
 * P1 item). Replaces two previously hardcoded widgets with data the
 * platform already ingests daily:
 *
 *  • Chokepoint transits — ais_chokepoint_observations (snapshot-chokepoints
 *    cron): latest 24h vessel count per chokepoint + delta vs the trailing
 *    7-day average. Chokepoints come from whatever the cron observed —
 *    a corridor absent from recent snapshots simply isn't listed.
 *
 *  • EIA inventory — eia_inventory_observations (ingest-eia-inventory
 *    cron). This widget shows W_EPC0_SAX_YCUOK_MBBL (weekly crude
 *    ending stocks at Cushing, OK, excl. SPR, thousand barrels); the
 *    table also carries WCESTUS1/WGTSTUS1/WDISTUS1 for other widgets.
 *
 * No fixture fallback: if a query fails the section reports
 * unavailable — the workspace renders an honest empty state instead of
 * plausible-looking numbers (verify-don't-assert).
 */

const CHOKEPOINT_LABELS: Record<string, string> = {
  hormuz: 'Hormuz',
  'bab-el-mandeb': 'Bab-el-Mandeb',
  bab: 'Bab-el-Mandeb',
  malacca: 'Malacca',
  suez: 'Suez',
  bosphorus: 'Bosphorus',
  panama: 'Panama',
};

interface ChokeRow {
  chokepoint: string;
  period: string;
  vessel_count: number;
  window_hours: number;
  snapshot_at: string;
}

interface EiaRow {
  series_id: string;
  period: string;
  value: number;
  unit: string;
  fetched_at: string;
}

export async function GET(_req: NextRequest) {
  const supabase = createServerSupabase();

  const [chokeRes, eiaRes] = await Promise.all([
    supabase
      .from('ais_chokepoint_observations')
      .select('chokepoint, period, vessel_count, window_hours, snapshot_at')
      .gte('snapshot_at', new Date(Date.now() - 14 * 24 * 3600_000).toISOString())
      .order('snapshot_at', { ascending: false }),
    supabase
      .from('eia_inventory_observations')
      .select('series_id, period, value, unit, fetched_at')
      // Pin to the Cushing series: ingest-eia-inventory now writes
      // several weekly stock series into this table, and an unfiltered
      // latest-26 would interleave them into a meaningless sparkline.
      .eq('series_id', EIA_CUSHING_CRUDE_STOCKS)
      .order('period', { ascending: false })
      .limit(26),
  ]);

  // Chokepoints: newest observation per corridor + trailing average of
  // the older observations in the 14d window (needs ≥3 to be meaningful).
  let chokepoints: Array<{
    chokepoint: string;
    label: string;
    latest_count: number;
    latest_period: string;
    window_hours: number;
    trailing_avg: number | null;
    delta_pct: number | null;
  }> | null = null;

  if (!chokeRes.error && chokeRes.data && chokeRes.data.length) {
    const byCorridor = new Map<string, ChokeRow[]>();
    for (const row of chokeRes.data as ChokeRow[]) {
      const list = byCorridor.get(row.chokepoint) ?? [];
      list.push(row); // arrives newest-first
      byCorridor.set(row.chokepoint, list);
    }
    chokepoints = [...byCorridor.entries()]
      .map(([slug, rows]) => {
        const latest = rows[0];
        const trailing = rows.slice(1);
        const avg = trailing.length >= 3
          ? trailing.reduce((s, r) => s + r.vessel_count, 0) / trailing.length
          : null;
        return {
          chokepoint: slug,
          label: CHOKEPOINT_LABELS[slug] ?? slug,
          latest_count: latest.vessel_count,
          latest_period: latest.period,
          window_hours: latest.window_hours,
          trailing_avg: avg === null ? null : Math.round(avg),
          delta_pct: avg ? Math.round(((latest.vessel_count - avg) / avg) * 100) : null,
        };
      })
      .sort((a, b) => b.latest_count - a.latest_count);
  }

  // EIA: newest-first series, reversed for the sparkline.
  let eia: {
    series_id: string;
    unit: string;
    latest: { period: string; value: number };
    prev: { period: string; value: number } | null;
    weekly_delta_pct: number | null;
    series: number[];
    fetched_at: string;
  } | null = null;

  if (!eiaRes.error && eiaRes.data && eiaRes.data.length) {
    const rows = eiaRes.data as EiaRow[];
    const latest = rows[0];
    const prev = rows[1] ?? null;
    eia = {
      series_id: latest.series_id,
      unit: latest.unit,
      latest: { period: latest.period, value: latest.value },
      prev: prev ? { period: prev.period, value: prev.value } : null,
      weekly_delta_pct: prev ? Math.round(((latest.value - prev.value) / prev.value) * 1000) / 10 : null,
      series: rows.map(r => r.value).reverse(),
      fetched_at: latest.fetched_at,
    };
  }

  return NextResponse.json(
    {
      chokepoints,
      eia,
      errors: [
        ...(chokeRes.error ? [`ais_chokepoint_observations: ${chokeRes.error.message}`] : []),
        ...(eiaRes.error ? [`eia_inventory_observations: ${eiaRes.error.message}`] : []),
      ],
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
