import { createServerSupabase } from '@/lib/supabase-server';
import { loadAisBoxes, loadWatchedCoverage } from '@/lib/marketing/watched-coverage';

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
  /** Confident-clear readings WITH a radiance retrieval on the newest
   *  published night — looks that could see, not rows sampled. From the
   *  named query in lib/marketing/watched-coverage.ts. */
  nightlightsClearReadings: number | null;
  /** The newest published night (YYYY-MM-DD). NASA publishes ~9 days behind. */
  nightlightsNewestNight: string | null;
  /** The thermal watch roster on its newest derived day (same named query):
   *  crude-oil refinery rows (site_type = 'refinery', migration 181 — the
   *  homepage's "refineries watched" population, 353 on 2026-09-19, not the
   *  449 refinery-tagged rows) and power-plant UNIT rows (>= 500 MW) inside
   *  the FIRMS boxes. Live coverage — unlike the 183,051-row registry it
   *  replaces. */
  thermalRefineryRows: number | null;
  thermalPowerUnitRows: number | null;
  /** The derived day those roster rows belong to (YYYY-MM-DD) — shown beside
   *  them so a stalled derivation reads as stale, not as live. */
  thermalDay: string | null;
  convergences21d: number | null;
  aisDaysSince: number | null; // 0 = fresh today; null = unknown
  /** Coverage boxes with no fix for >24h: [{label, daysSince}]. null = liveness
   *  table absent (migration 110 not applied) — the cell then falls back to the
   *  global figure alone rather than implying every box is healthy. */
  aisDeadBoxes: Array<{ label: string; daysSince: number }> | null;
  /** Configured AIS boxes by kind, from ais_box_liveness (migration 110), and
   *  the box carrying the most vessels right now. null = table absent. The
   *  copy that said "chokepoint-only" was false from 2026-08-24; this makes
   *  the replacement copy computed rather than a second literal to rot. */
  aisBoxes: { broad: number; chokepoint: number; densest: string | null } | null;
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

  // Night-lights and the thermal roster come from the ONE named query every
  // public surface reads (lib/marketing/watched-coverage.ts). The first
  // version of this file counted firms_monitored_facilities (183,051) and
  // called it "sites watched"; the second counted every radiance ROW on the
  // newest night (10,412 on 09-09) and called them "facilities" — rows of
  // generating units, cloudy or not. What the board now quotes is the number
  // of confident-clear readings that carry a retrieval: looks that could see.
  const [thermal48h, conflict48h, nightlightsEvents, watched, convergences21d, aisNewest, aisBoxSummary] =
    await Promise.all([
      count('firms_thermal_anomalies', (q: any) => q.gte('ingested_at', hoursAgo(48))),
      count('conflict_events', (q: any) => q.gte('ingested_at', hoursAgo(48))),
      count('nightlights_significant_events'),
      loadWatchedCoverage(),
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
      // broken component — so the board also names the boxes that are dark.
      // Read through the same named-query module as /mcp and /llms.txt.
      loadAisBoxes(),
    ]);

  const aisDeadBoxes = aisBoxSummary ? aisBoxSummary.dead : null;
  const aisBoxes = aisBoxSummary
    ? { broad: aisBoxSummary.broad, chokepoint: aisBoxSummary.chokepoint, densest: aisBoxSummary.densest }
    : null;

  let aisDaysSince: number | null = null;
  if (aisNewest) {
    aisDaysSince = Math.floor((Date.now() - new Date(aisNewest).getTime()) / 86_400_000);
  }

  return {
    thermal48h,
    conflict48h,
    nightlightsEvents,
    nightlightsClearReadings: watched.nightlightsClearReadings,
    nightlightsNewestNight: watched.nightlightsNight,
    thermalRefineryRows: watched.thermalRefineryRows,
    thermalPowerUnitRows: watched.thermalPowerUnitRows,
    thermalDay: watched.thermalDay,
    convergences21d,
    aisDaysSince,
    aisDeadBoxes,
    aisBoxes,
  };
}

