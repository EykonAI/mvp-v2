import type { Resolver } from './types';

/**
 * Reality Check resolver (machine track, source 'refinery-rc', PR-5).
 *
 * The rule lives in ONE place — refinery_rc_resolution() in Postgres (mig 170)
 * — so the guard script can prove it against synthetic rows and this file can
 * never drift from it. This is the thin wrapper the scorer dispatches to:
 *
 *   state 'ready' -> observed 0 | 1
 *   state 'void'  -> VOID with the rule's reason (retired key; < 12 of 14 FIRMS
 *                    days observed; < 3 usable clear nights with a retrieval;
 *                    VOID in both next ticks; window unpublished 45 days on)
 *   state 'defer' -> null: the instrument has not finalised the window yet
 *                    (#482 — never a verdict on a window still publishing)
 *
 * A failed call is null too (retry next tick), never a guess. Lookup is by
 * context — cluster_key, the frozen members, window_start/window_end — never
 * by parsing target_observable (#465).
 */
type Answer = { state?: unknown; observed?: unknown; void_reason?: unknown };

export const resolveRefineryRc: Resolver = async (row, supabase) => {
  const { data, error } = await supabase.rpc('refinery_rc_resolution', {
    p_feature: row.feature,
    p_context: row.context ?? {},
  });
  if (error || !data || typeof data !== 'object') return null;
  const a = data as Answer;
  if (a.state === 'defer') return null;
  if (a.state === 'void') {
    return {
      observed: 0,
      source_url: '/intel/calibration',
      void_reason: typeof a.void_reason === 'string' && a.void_reason ? a.void_reason : 'refinery-rc: void without a stated reason',
    };
  }
  if (a.state === 'ready' && (a.observed === 0 || a.observed === 1)) {
    return { observed: a.observed, source_url: '/intel/calibration' };
  }
  return null;
};
