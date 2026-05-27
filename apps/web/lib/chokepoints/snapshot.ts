import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Chokepoint vessel-count snapshot helper.
 *
 * Calls the count_chokepoint_vessels(slug, window_hours) RPC added
 * in migration 043. Returns null on RPC failure so the cron can
 * surface a per-chokepoint error without blowing up the whole tick.
 *
 * Window-hours defaults to 24 to absorb AIS reception patchiness —
 * vessels in remote bearings can update infrequently and a strict
 * "today only" filter would undercount by 20–40% on bad-reception
 * days. Tune via cron call if a chokepoint has tighter coverage.
 */
export interface ChokepointSnapshot {
  chokepoint: string;
  vessel_count: number;
  window_hours: number;
}

export async function snapshotChokepoint(
  supabase: SupabaseClient,
  slug: string,
  windowHours = 24,
): Promise<ChokepointSnapshot | null> {
  const { data, error } = await supabase.rpc('count_chokepoint_vessels', {
    p_slug: slug,
    p_window_hours: windowHours,
  });
  if (error) return null;
  const count = Number(data);
  if (!Number.isFinite(count) || count < 0) return null;
  return { chokepoint: slug, vessel_count: count, window_hours: windowHours };
}

// Explicit list of chokepoints the daily cron snapshots. Start narrow
// (Hormuz only) so PR-CAL-HORMUZ stays scoped; adding suez / malacca /
// bab-el-mandeb later is a one-line list change once each has its own
// issuer template.
export const SNAPSHOT_CHOKEPOINTS: ReadonlyArray<string> = ['hormuz'];
