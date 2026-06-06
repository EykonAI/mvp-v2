import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { getFoundingSeats } from '@/lib/founding-seats';
import { WaitlistAdminClient, type WaitlistRow, type WaitlistStats } from './WaitlistAdminClient';

// /admin/waitlist — founder-only view of the fiat billing waitlist.
//
// Read-side only (F-2, read stage): contacts + tier + country + status +
// real spots-left. The side-effectful bulk-email action lands in a separate
// PR given its blast radius.
//
// Founder gate mirrors app/(app)/admin/refunds/page.tsx: isFounder() against
// FOUNDER_EMAILS env (there is no is_admin column). Unset env → every request
// redirects to /app (admin existence shouldn't leak).
//
// NOTE: the `country` column requires migration 049 to be applied first.
// Railway auto-deploys main on merge, so apply 049 in the Supabase Dashboard
// → SQL Editor BEFORE merging this PR, or this .select() 500s at runtime.

export const metadata = { title: 'Admin · Waitlist — eYKON.ai' };
export const dynamic = 'force-dynamic';

export default async function WaitlistAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/waitlist');
  if (!isFounder(user)) redirect('/app');

  const admin = createServerSupabase();
  const { data: rows } = await admin
    .from('fiat_waitlist')
    .select(
      'id, email, tier, note, referral_code, country, confirmed_email, notified_at, converted_user_id, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(2000);

  const entries: WaitlistRow[] = ((rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: String(r.id ?? ''),
    email: (r.email as string | null) ?? null,
    tier: (r.tier as WaitlistRow['tier']) ?? 'pro',
    note: (r.note as string | null) ?? null,
    referral_code: (r.referral_code as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    confirmed_email: Boolean(r.confirmed_email),
    notified_at: (r.notified_at as string | null) ?? null,
    converted_user_id: (r.converted_user_id as string | null) ?? null,
    created_at: String(r.created_at ?? ''),
  }));

  const seats = await getFoundingSeats();
  const stats: WaitlistStats = {
    total: entries.length,
    pro: entries.filter(e => e.tier === 'pro').length,
    enterprise: entries.filter(e => e.tier === 'enterprise').length,
    confirmed: entries.filter(e => e.confirmed_email).length,
    notified: entries.filter(e => e.notified_at !== null).length,
    converted: entries.filter(e => e.converted_user_id !== null).length,
    cap: seats.cap,
    claimed: seats.claimed,
    paidFounders: seats.paidFounders,
    reservedWaitlist: seats.reservedWaitlist,
    spotsLeft: seats.spotsLeft,
  };

  return <WaitlistAdminClient entries={entries} stats={stats} />;
}
