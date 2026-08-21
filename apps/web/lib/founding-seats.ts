import { createServerSupabase } from '@/lib/supabase-server';

/**
 * Founding-seat accounting — the single source of truth for "spots left".
 *
 * Cap = 1,000 ("Founding Members · First 1,000 · Rate locked for life").
 *
 * SUPERSEDED 2026-08-21 (PR E-bis). A seat is now consumed ONLY by payment:
 *
 *   spotsLeft = 1000 − paidFounders
 *
 * The old rule (D-1, 2026-06-06 handover brief) also subtracted unconverted
 * fiat_waitlist rows, on the premise that someone waiting for card billing
 * had a claim on a seat. Two things retired it:
 *
 *   1. Fiat billing was cancelled, so a "reservation" pending fiat is a hold
 *      against something that is not coming. Holding seats back from people
 *      who CAN pay, for people who cannot, is the opposite of first come
 *      first served — which is what the page now promises.
 *   2. The reservation was mostly fictional. 22 of the 25 rows were bot
 *      signups (see /api/waitlist hardening, same date); the counter was
 *      withholding 25 seats on behalf of two real people, both of whom were
 *      contacted directly.
 *
 * Consequence, stated plainly because the number is public and watched:
 * spotsLeft moves 974 → 999 on deploy. It goes UP. That is the counter
 * becoming honest, not a reset — it had been understating availability.
 *
 * The waitlist itself stays open as a prospect list for when fiat ships; it
 * simply no longer reserves inventory. reservedWaitlist is still REPORTED
 * (the admin page shows the list size) but no longer SUBTRACTED.
 *
 *   • paidFounders    — distinct users with a COMPLETED founding purchase.
 *                       We count from the purchases ledger, NOT
 *                       user_profiles.founding_rate_locked: that flag is
 *                       unmaintained (verified 0 rows set on 2026-06-06
 *                       despite a real completed founding purchase), so the
 *                       ledger is the accurate signal.
 *   • reservedWaitlist — fiat_waitlist rows that have NOT converted.
 *                       REPORTED ONLY — not subtracted from spotsLeft.
 *                       Retained so the admin page can show list size.
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
  // Reported, deliberately NOT part of `claimed` — see the note above.
  const claimed = paidFounders;
  const spotsLeft = Math.max(0, FOUNDING_CAP - claimed);

  return { cap: FOUNDING_CAP, paidFounders, reservedWaitlist, claimed, spotsLeft };
}
