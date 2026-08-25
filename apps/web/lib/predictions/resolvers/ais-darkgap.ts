import type { Resolver } from './types';

/**
 * Dark-contact reappearance resolver (machine track).
 *
 * target_observable convention (set by issue-dark-contact.ts, mirroring the
 * event table's dedup key):
 *
 *   `ais:dark_contact:<mmsi>:<gap_started_at ISO>`
 *
 * The register row resolves FROM the event row — the event lifecycle (owned
 * by the hourly compute-shadow-fleet-scores cron, mig 112) is the single
 * source of truth, and this resolver only translates its terminal states:
 *
 *   reappeared  → observed = 1  (a newer fix arrived — positive observation)
 *   still_dark  → observed = 0  (not re-observed by our coverage in 72 h —
 *                 exactly what the claim asserted would not be the case)
 *   void        → VOID with the event's coverage_lost reason. The box that
 *                 measured the silence died; nothing was seen; the claim is
 *                 neither a win nor a loss.
 *   open        → null (defer to the next score-predictions tick; the event
 *                 cron closes events at the same deadline this row resolves
 *                 at, so at most one tick of lag)
 *
 * If the event row is MISSING (deleted, or the observable was malformed),
 * defer for 7 days past resolution then VOID with a stated reason — the
 * EIA lesson: never let an absence of data resolve a claim in either
 * direction.
 */

const VOID_AFTER_MISSING_DAYS = 7;

export const resolveAisDarkgap: Resolver = async (row, supabase) => {
  const parsed = parse(row.target_observable);
  if (!parsed) return null;

  const { data: ev, error } = await supabase
    .from('dark_contact_events')
    .select('status, resolution, void_reason, closed_at')
    .eq('mmsi', parsed.mmsi)
    .eq('gap_started_at', parsed.gapStartedAt)
    .maybeSingle();

  if (error) return null; // transient — retry next tick

  if (!ev) {
    const overdueMs = Date.now() - Date.parse(row.resolves_at);
    if (overdueMs > VOID_AFTER_MISSING_DAYS * 86_400_000) {
      return {
        observed: 0,
        source_url: '/intel/shadow-fleet',
        void_reason: `event row not found for ${row.target_observable} within ${VOID_AFTER_MISSING_DAYS} days of resolution`,
      };
    }
    return null;
  }

  if (ev.status === 'open') return null;

  if (ev.status === 'void') {
    return {
      observed: 0,
      source_url: '/intel/shadow-fleet',
      void_reason: ev.void_reason ?? 'coverage_lost',
    };
  }

  return {
    observed: ev.resolution === 'reappeared' ? 1 : 0,
    source_url: '/intel/shadow-fleet',
  };
};

function parse(observable: string): { mmsi: string; gapStartedAt: string } | null {
  // ais:dark_contact:<mmsi>:<ISO timestamp — itself contains colons>
  const prefix = 'ais:dark_contact:';
  if (!observable.startsWith(prefix)) return null;
  const rest = observable.slice(prefix.length);
  const firstColon = rest.indexOf(':');
  if (firstColon <= 0) return null;
  const mmsi = rest.slice(0, firstColon);
  const gapStartedAt = rest.slice(firstColon + 1);
  if (!mmsi || Number.isNaN(Date.parse(gapStartedAt))) return null;
  return { mmsi, gapStartedAt };
}
