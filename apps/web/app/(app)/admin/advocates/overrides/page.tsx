import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { isFounder } from '@/lib/admin/access';
import {
  OverridesClient,
  type ReferralRow,
  type AccrualRow,
  type AdminActionRow,
  type EligibleAdvocate,
} from './OverridesClient';

// /admin/advocates/overrides — founder-only data-fix-up surface
// for the three force-overrides from spec §6.10:
//
//   • force-mark threshold on a referral whose streak counter
//     mistakenly reset
//   • force-cancel a stuck pending accrual
//   • force-create a referral row from an attributed conversion
//     the system missed (the manual backfill path for the gap
//     between launch and the engine PRs landing)
//
// Every override produces one admin_actions row (migration 027)
// with a mandatory override_reason.

export const dynamic = 'force-dynamic';

export default async function OverridesAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/advocates/overrides');
  if (!isFounder(user)) redirect('/app');

  const admin = createServerSupabase();

  // Referrals + their related advocate/referred email for display.
  // No JOIN through PostgREST yet — two queries + a client-side
  // merge keeps this readable.
  const { data: referralRows } = await admin
    .from('referrals')
    .select(
      'id, advocate_user_id, referred_user_id, status, threshold_satisfied, threshold_satisfied_at, commission_rate, is_above_annual_cap, commissioned_from, commission_window_ends_at, pending_commission_cents, released_commission_cents, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  const userIds = new Set<string>();
  for (const r of (referralRows ?? []) as Array<Record<string, unknown>>) {
    if (typeof r.advocate_user_id === 'string') userIds.add(r.advocate_user_id);
    if (typeof r.referred_user_id === 'string') userIds.add(r.referred_user_id);
  }
  const profiles = userIds.size
    ? (
        await admin
          .from('user_profiles')
          .select('id, email, display_name')
          .in('id', [...userIds])
      ).data ?? []
    : [];

  const profileMap = new Map<string, { email: string | null; display_name: string | null }>(
    (profiles as Array<Record<string, unknown>>).map((p) => [
      String(p.id ?? ''),
      {
        email: (p.email as string | null) ?? null,
        display_name: (p.display_name as string | null) ?? null,
      },
    ]),
  );

  const referrals: ReferralRow[] = ((referralRows ?? []) as Array<Record<string, unknown>>).map((r) => {
    const advocateId = String(r.advocate_user_id ?? '');
    const referredId = String(r.referred_user_id ?? '');
    const advocate = profileMap.get(advocateId);
    const referred = profileMap.get(referredId);
    return {
      id: String(r.id ?? ''),
      advocate_user_id: advocateId,
      advocate_email: advocate?.email ?? null,
      advocate_display_name: advocate?.display_name ?? null,
      referred_user_id: referredId,
      referred_email: referred?.email ?? null,
      referred_display_name: referred?.display_name ?? null,
      status: String(r.status ?? 'pre_threshold'),
      threshold_satisfied: Boolean(r.threshold_satisfied),
      threshold_satisfied_at: (r.threshold_satisfied_at as string | null) ?? null,
      commission_rate: Number(r.commission_rate ?? 0),
      is_above_annual_cap: Boolean(r.is_above_annual_cap),
      commissioned_from: String(r.commissioned_from ?? ''),
      commission_window_ends_at: String(r.commission_window_ends_at ?? ''),
      pending_commission_cents: Number(r.pending_commission_cents ?? 0),
      released_commission_cents: Number(r.released_commission_cents ?? 0),
      created_at: String(r.created_at ?? ''),
    };
  });

  // Pending accruals (most recent 200). Empty until PR 9 ships.
  const { data: accrualRows } = await admin
    .from('referral_commission_accruals')
    .select('id, referral_id, accrual_month, commission_amount_cents, state, created_at')
    .eq('state', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);

  const accruals: AccrualRow[] = ((accrualRows ?? []) as Array<Record<string, unknown>>).map((a) => ({
    id: String(a.id ?? ''),
    referral_id: String(a.referral_id ?? ''),
    accrual_month: String(a.accrual_month ?? ''),
    commission_amount_cents: Number(a.commission_amount_cents ?? 0),
    state: String(a.state ?? 'pending'),
    created_at: String(a.created_at ?? ''),
  }));

  // Eligible advocates for the force-create form: 'active' or
  // 'paused'. Excludes terminated advocates because their existing
  // referrals continue but no NEW commission relationships can
  // form (spec §2.7).
  const { data: eligibleRows } = await admin
    .from('user_profiles')
    .select('id, email, display_name, advocate_state')
    .in('advocate_state', ['active', 'paused'])
    .order('email');

  const eligibleAdvocates: EligibleAdvocate[] = ((eligibleRows ?? []) as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id ?? ''),
    email: (p.email as string | null) ?? null,
    display_name: (p.display_name as string | null) ?? null,
    advocate_state: String(p.advocate_state ?? 'active'),
  }));

  // Recent admin actions — always-on transparency for the founder.
  const { data: actionRows } = await admin
    .from('admin_actions')
    .select('id, action, target_table, target_id, override_reason, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  const actions: AdminActionRow[] = ((actionRows ?? []) as Array<Record<string, unknown>>).map((a) => ({
    id: String(a.id ?? ''),
    action: String(a.action ?? ''),
    target_table: String(a.target_table ?? ''),
    target_id: String(a.target_id ?? ''),
    override_reason: String(a.override_reason ?? ''),
    payload: (a.payload ?? {}) as Record<string, unknown>,
    created_at: String(a.created_at ?? ''),
  }));

  return (
    <OverridesClient
      referrals={referrals}
      accruals={accruals}
      eligibleAdvocates={eligibleAdvocates}
      recentActions={actions}
    />
  );
}
