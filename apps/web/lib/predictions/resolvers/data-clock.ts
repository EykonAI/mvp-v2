import type { SupabaseAny } from './types';

/**
 * The DATA clock of a daily-period instrument: the newest `period` it has
 * published into its observation table. Read with the (period DESC) index on
 * each table — an index-only probe, cheap enough to run per claim.
 *
 * WHY A RESOLVER MUST ASK THIS FIRST. A claim's window can only be judged once
 * the instrument has finished publishing it. Before that, "no clear night in
 * the window" means "not yet looked", and the only honest answer is to DEFER
 * — never VOID, never a verdict on a partial window. The night-lights issuer
 * (mig 128) already anchors on this clock; the resolver did not, so the first
 * 85 claims it issued were due on the wall clock the moment they were written,
 * into a window the sensor had not published. The resolver's own void text
 * named "publication lag" as a cause and voided anyway. That is #465 again: a
 * look that has not happened, read as "nothing there".
 *
 * STRICTLY AFTER, not at. The newest published period can itself be partial —
 * Black Marble night 2026-08-25 landed as 20 of 84 tiles and sat as the
 * newest night for days. A period is only known complete once a later one
 * exists, so a window ending on `end` is judged when clock > end.
 *
 * BOUNDED. Deferral is the scorer's existing contract (null → deferred,
 * retried next tick). If the wall clock passes end + INSTRUMENT_STALE_DAYS and
 * the instrument still has not published past the window, the claim is voided
 * as "instrument did not publish" — which is true, and it stops a dead worker
 * from leaving immortal pending claims at the head of the queue.
 */
export const INSTRUMENT_STALE_DAYS = 45;

export type InstrumentTable = 'blackmarble_facility_radiance' | 'firms_facility_observations';

/** Newest published period (ISO date) or null when the probe failed. */
export async function instrumentDataClock(
  table: InstrumentTable,
  supabase: SupabaseAny,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select('period')
    .order('period', { ascending: false })
    .limit(1);
  if (error) return null;
  const p = data?.[0]?.period;
  return typeof p === 'string' ? p.slice(0, 10) : null;
}

export type ClockVerdict =
  | { kind: 'ready' }
  | { kind: 'defer' }
  | { kind: 'void'; reason: string };

/**
 * Decide whether a window ending on `end` (ISO date) may be judged now.
 * ISO dates compare lexically, so string comparison is date comparison.
 */
export function windowVerdict(
  instrument: string,
  clock: string | null,
  end: string,
  now: Date = new Date(),
): ClockVerdict {
  if (clock !== null && clock > end) return { kind: 'ready' };
  const staleDays = (now.getTime() - Date.parse(`${end}T00:00:00Z`)) / 86_400_000;
  if (staleDays > INSTRUMENT_STALE_DAYS) {
    return {
      kind: 'void',
      reason: `${instrument} published only to ${clock ?? 'nothing'}, ${Math.floor(staleDays)} days after window end ${end} — instrument did not publish the window, not looked`,
    };
  }
  return { kind: 'defer' };
}
