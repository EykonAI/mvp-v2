import type { Resolver } from './types';

/**
 * Sentinel-1 anchorage resolver (machine track, source 's1-anchorage',
 * Imagery IMG-10, mig 193).
 *
 * The rule lives in ONE place — s1_anchorage_resolution() in Postgres — so
 * the guard script proves it and this wrapper cannot drift from it:
 *
 *   state 'ready' -> observed 0 | 1 (week median vs the frozen baseline median)
 *   state 'void'  -> VOID with the rule's reason: no clear pass in the week,
 *                    the method or anchorage no longer admitted, malformed
 *                    context, or no S1 check covered the week 45 days on
 *   state 'defer' -> null: the ingest has not looked past the week yet (#482)
 *
 * A failed call is null too (retry next tick), never a guess. Lookup is by
 * context (aoi_id, week_start, week_end, baseline_median), never by parsing
 * target_observable (#465).
 */
type Answer = { state?: unknown; observed?: unknown; void_reason?: unknown };

export const resolveS1Anchorage: Resolver = async (row, supabase) => {
  const { data, error } = await supabase.rpc('s1_anchorage_resolution', { p_context: row.context ?? {} });
  if (error || !data || typeof data !== 'object') return null;
  const a = data as Answer;
  if (a.state === 'defer') return null;
  if (a.state === 'void') {
    return {
      observed: 0,
      source_url: '/intel/calibration',
      void_reason: typeof a.void_reason === 'string' && a.void_reason ? a.void_reason : 's1-anchorage: void without a stated reason',
    };
  }
  if (a.state === 'ready' && (a.observed === 0 || a.observed === 1)) {
    return { observed: a.observed, source_url: '/intel/calibration' };
  }
  return null;
};
