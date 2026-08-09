import { createServerSupabase } from '@/lib/supabase-server';
import { EIA_CUSHING_CRUDE_STOCKS } from '@/lib/eia/client';

/**
 * Commodities workspace — live inputs builder (chokepoint corridors +
 * EIA Cushing stocks). Extracted from the live route (PR 2) so the
 * export snapshot reuses the exact coverage-aware computation the
 * panel renders. Methodology notes retained below.
 */

export interface LivePayload {
  chokepoints: Array<{
    chokepoint: string;
    label: string;
    no_data: boolean;
    days_since: number;
    latest_count: number;
    latest_period: string;
    window_hours: number;
    trailing_avg: number | null;
    delta_pct: number | null;
  }> | null;
  eia: {
    series_id: string;
    unit: string;
    latest: { period: string; value: number };
    prev: { period: string; value: number } | null;
    weekly_delta_pct: number | null;
    series: number[];
    fetched_at: string;
  } | null;
  errors: string[];
}

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

export async function buildLivePayload(): Promise<LivePayload> {
  const supabase = createServerSupabase();

  const [chokeRes, eiaRes] = await Promise.all([
    supabase
      .from('ais_chokepoint_observations')
      .select('chokepoint, period, vessel_count, window_hours, snapshot_at')
      // 30d (not 14d): the snapshot cron now skips dead-feed days
      // entirely (feed-liveness guard, 2026-08-09), so during an AIS
      // outage no new rows appear and the widest window keeps the
      // last-observed counts visible for the honest NO DATA state.
      .gte('snapshot_at', new Date(Date.now() - 30 * 24 * 3600_000).toISOString())
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
  // Coverage-aware corridors (2026-08-09). Every stored row is now a
  // real look (the cron's feed-liveness guard skips dead-feed days and
  // migration 103 removed the poisoned zeros), so a corridor whose
  // newest snapshot is older than the daily cadence was NOT observed
  // since then. That renders as NO DATA with the last-observed count —
  // never as a number, never as a delta. Absence of an observation is
  // not a result.
  let chokepoints: Array<{
    chokepoint: string;
    label: string;
    no_data: boolean;
    days_since: number;
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
    // 26h = daily cadence + 2h grace for cron jitter. Past that, the
    // newest row no longer describes the last 24h.
    const COVERAGE_MAX_AGE_MS = 26 * 3600_000;
    const now = Date.now();
    chokepoints = [...byCorridor.entries()]
      .map(([slug, rows]) => {
        const latest = rows[0];
        const ageMs = now - new Date(latest.snapshot_at).getTime();
        const noData = ageMs > COVERAGE_MAX_AGE_MS;
        const trailing = rows.slice(1);
        const avg = trailing.length >= 3
          ? trailing.reduce((s, r) => s + r.vessel_count, 0) / trailing.length
          : null;
        return {
          chokepoint: slug,
          label: CHOKEPOINT_LABELS[slug] ?? slug,
          no_data: noData,
          days_since: Math.floor(ageMs / (24 * 3600_000)),
          // When no_data, latest_* is the LAST OBSERVED look, and the
          // delta is withheld — a delta against a stale look is a claim
          // about a window we did not see.
          latest_count: latest.vessel_count,
          latest_period: latest.period,
          window_hours: latest.window_hours,
          trailing_avg: avg === null ? null : Math.round(avg),
          delta_pct: !noData && avg ? Math.round(((latest.vessel_count - avg) / avg) * 100) : null,
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

  return {
      chokepoints,
      eia,
      errors: [
        ...(chokeRes.error ? [`ais_chokepoint_observations: ${chokeRes.error.message}`] : []),
        ...(eiaRes.error ? [`eia_inventory_observations: ${eiaRes.error.message}`] : []),
      ],
    };
}
