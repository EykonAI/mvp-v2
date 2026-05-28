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

// Explicit list of chokepoints the daily cron snapshots.
//
// Coverage note (2026-05-27): AISStream's free tier delivers a
// Europe-dominated firehose. A geographic audit of fresh vessel
// positions showed usable coverage only for Malacca (~453/1.75h),
// Suez (~161), and Bosphorus (~43). Hormuz, Bab-el-Mandeb, and Panama
// returned ~0 — the free tier has no Persian Gulf / Arabian Sea /
// Caribbean receivers. Those three stay out of the snapshot list until
// a paid AIS source covers them (Phase 2).
//
// Malacca is the primary prediction subject (see issue-chokepoint-weekly).
// Suez + Bosphorus are snapshotted too so their baselines accumulate for
// free, ready for secondary weekly issuers later.
export const SNAPSHOT_CHOKEPOINTS: ReadonlyArray<string> = ['malacca', 'suez', 'bosphorus'];
