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
  watchedFacilities: number | null;
  convergences21d: number | null;
  aisDaysSince: number | null; // 0 = fresh today; null = unknown
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

  const [thermal48h, conflict48h, nightlightsEvents, watchedFacilities, convergences21d, aisNewest] =
    await Promise.all([
      count('firms_thermal_anomalies', (q: any) => q.gte('ingested_at', hoursAgo(48))),
      count('conflict_events', (q: any) => q.gte('ingested_at', hoursAgo(48))),
      count('nightlights_significant_events'),
      count('firms_monitored_facilities'),
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
    ]);

  let aisDaysSince: number | null = null;
  if (aisNewest) {
    aisDaysSince = Math.floor((Date.now() - new Date(aisNewest).getTime()) / 86_400_000);
  }

  return { thermal48h, conflict48h, nightlightsEvents, watchedFacilities, convergences21d, aisDaysSince };
}
