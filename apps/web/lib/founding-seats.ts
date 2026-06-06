import { createServerSupabase } from '@/lib/supabase-server';

/**
 * Founding-seat accounting — the single source of truth for "spots left".
 *
 * Cap = 1,000 ("Founding Members · First 1,000 · Rate locked for life").
 *
 * Per decision D-1 (2026-06-06 handover brief), a seat is consumed by
 * EITHER a paid founder OR a waitlist reservation:
 *
 *   spotsLeft = 1000 − paidFounders − reservedWaitlist
 *
 *   • paidFounders    — distinct users with a COMPLETED founding purchase.
 *                       We count from the purchases ledger, NOT
 *                       user_profiles.founding_rate_locked: that flag is
 *                       unmaintained (verified 0 rows set on 2026-06-06
 *                       despite a real completed founding purchase), so the
 *                       ledger is the accurate signal.
 *   • reservedWaitlist — fiat_waitlist rows that have NOT converted. A
 *                       converted entry (converted_user_id set) becomes a
 *                       paid founder, so excluding it here avoids
 *                       double-counting the same person.
 *
 * spotsLeft is floored at 0.
 */
export const FOUNDING_CAP = 1000;

export type FoundingSeats = {
  cap: number;
  paidFounders: number;
  reservedWaitlist: number;
  claimed: number;
  spotsLeft: number;
};

export async function getFoundingSeats(): Promise<FoundingSeats> {
  const admin = createServerSupabase();

  const [{ data: founderRows }, { count: waitlistCount }] = await Promise.all([
    admin
      .from('purchases')
      .select('user_id')
      .eq('status', 'completed')
      .ilike('variant_id', '%founding%'),
    admin
      .from('fiat_waitlist')
      .select('id', { count: 'exact', head: true })
      .is('converted_user_id', null),
  ]);

  const paidFounders = new Set(
    (founderRows ?? []).map(r => (r as { user_id: string | null }).user_id).filter(Boolean),
  ).size;
  const reservedWaitlist = waitlistCount ?? 0;
  const claimed = paidFounders + reservedWaitlist;
  const spotsLeft = Math.max(0, FOUNDING_CAP - claimed);

  return { cap: FOUNDING_CAP, paidFounders, reservedWaitlist, claimed, spotsLeft };
}
