import { createServerSupabase } from '@/lib/supabase-server';

/**
 * Live feed states for the /start honesty board (Screen 4).
 *
 * The board's contract: it must be live, and it must be ALLOWED TO LOOK
 * BAD. If AIS recovers the amber cell turns green on its own; if FIRMS
 * stalls the green cell goes amber on its own. A hard-coded status board
 * that always shows health is precisely the instrument-not-world failure
 * this platform exists to avoid — and the audience for this page audits
 * calibration ledgers for entertainment.
 *
 * Every count fails soft to null (rendered as "—"), never to a fabricated
 * number. Table and column names verified against production via
 * supabase-ro before writing, per the verify-don't-assert directive.
 */
export interface ClosingStatus {
  thermal48h: number | null;
  conflict48h: number | null;
  nightlightsEvents: number | null;
  /** Facilities sampled on the newest PUBLISHED night — not registry rows. */
  nightlightsFacilities: number | null;
  /** The newest published night (YYYY-MM-DD). NASA publishes ~9 days behind. */
  nightlightsNewestNight: string | null;
  convergences21d: number | null;
  aisDaysSince: number | null; // 0 = fresh today; null = unknown
  /** Coverage boxes with no fix for >24h: [{label, daysSince}]. null = liveness
   *  table absent (migration 110 not applied) — the cell then falls back to the
   *  global figure alone rather than implying every box is healthy. */
  aisDeadBoxes: Array<{ label: string; daysSince: number }> | null;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export async function loadClosingStatus(): Promise<ClosingStatus> {
  const admin = createServerSupabase();

  const count = async (
    table: string,
    filter?: (q: ReturnType<ReturnType<typeof createServerSupabase>['from']>['select'] extends never ? never : any) => any,
  ): Promise<number | null> => {
    try {
      let q = admin.from(table).select('*', { count: 'exact', head: true });
      if (filter) q = filter(q);
      const { count: c, error } = await q;
      return error ? null : (c ?? null);
    } catch {
      return null;
    }
  };

  // Night-lights coverage: facilities sampled on the newest PUBLISHED
  // night, from the radiance table itself. The first version of this file
  // counted firms_monitored_facilities (183,051) and called it "sites
  // watched" — the exact §6.6 registry-rows-are-not-sites trap, on the
  // page whose whole pitch is honesty. Count what was actually sampled.
  const nightlights = (async (): Promise<{ n: number | null; night: string | null }> => {
    try {
      const { data: newest } = await admin
        .from('blackmarble_facility_radiance')
        .select('period')
        .order('period', { ascending: false })
        .limit(1)
        .maybeSingle();
      const night = (newest as { period: string } | null)?.period ?? null;
      if (!night) return { n: null, night: null };
      const { count: c, error } = await admin
        .from('blackmarble_facility_radiance')
        .select('*', { count: 'exact', head: true })
        .eq('period', night);
      return { n: error ? null : (c ?? null), night };
    } catch {
      return { n: null, night: null };
    }
  })();

  const [thermal48h, conflict48h, nightlightsEvents, nl, convergences21d, aisNewest, aisDeadBoxes] =
    await Promise.all([
      count('firms_thermal_anomalies', (q: any) => q.gte('ingested_at', hoursAgo(48))),
      count('conflict_events', (q: any) => q.gte('ingested_at', hoursAgo(48))),
      count('nightlights_significant_events'),
      nightlights,
      count('convergence_events', (q: any) => q.gte('created_at', hoursAgo(21 * 24))),
      (async () => {
        try {
          const { data } = await admin
            .from('vessel_positions')
            .select('ingested_at')
            .order('ingested_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          return (data as { ingested_at: string } | null)?.ingested_at ?? null;
        } catch {
          return null;
        }
      })(),
      // Per-box AIS liveness (migration 110). The global MAX above cannot see a
      // dead box: it reported the feed LIVE through 23 days of Hormuz silence,
      // because Europe's fixes kept the aggregate fresh. An aggregate hides a
      // broken component — so the board now also names the boxes that are dark.
      (async (): Promise<Array<{ label: string; daysSince: number }> | null> => {
        try {
          const { data, error } = await admin
            .from('ais_box_liveness')
            .select('label, newest_fix');
          if (error || !data?.length) return null;
          return (data as Array<{ label: string; newest_fix: string | null }>)
            .filter(r => r.newest_fix && Date.now() - new Date(r.newest_fix).getTime() > 24 * 3600_000)
            .map(r => ({
              label: r.label,
              daysSince: Math.floor((Date.now() - new Date(r.newest_fix as string).getTime()) / 86_400_000),
            }))
            .sort((a, b) => b.daysSince - a.daysSince);
        } catch {
          return null;
        }
      })(),
    ]);

  let aisDaysSince: number | null = null;
  if (aisNewest) {
    aisDaysSince = Math.floor((Date.now() - new Date(aisNewest).getTime()) / 86_400_000);
  }

  return {
    thermal48h,
    conflict48h,
    nightlightsEvents,
    nightlightsFacilities: nl.n,
    nightlightsNewestNight: nl.night,
    convergences21d,
    aisDaysSince,
    aisDeadBoxes,
  };
}
