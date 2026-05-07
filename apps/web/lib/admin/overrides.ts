/**
 * Server-side helpers for the three founder force-overrides
 * (spec §6.10). Each helper validates inputs, applies the
 * mutation through the service-role client, and writes one row
 * to admin_actions for the audit trail. The action codes here
 * mirror the CHECK constraint in migration 027 — keep in sync.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type OverrideAction =
  | 'force_mark_threshold'
  | 'force_cancel_accrual'
  | 'force_create_referral';

export type OverrideResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const MIN_REASON_LEN = 12;

export function validateReason(reason: string | null | undefined): string | null {
  if (!reason) return 'reason_required';
  if (reason.trim().length < MIN_REASON_LEN) return 'reason_too_short';
  if (reason.length > 2000) return 'reason_too_long';
  return null;
}

// ─── force-mark threshold ─────────────────────────────────────

export async function forceMarkThreshold(
  admin: SupabaseClient,
  actorId: string,
  args: { referral_id: string; reason: string },
): Promise<OverrideResult<{ referral_id: string }>> {
  const reasonErr = validateReason(args.reason);
  if (reasonErr) return { ok: false, error: reasonErr };

  const { data: row, error: lookupErr } = await admin
    .from('referrals')
    .select('id, threshold_satisfied, status')
    .eq('id', args.referral_id)
    .maybeSingle();

  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!row) return { ok: false, error: 'referral_not_found' };

  const referral = row as { id: string; threshold_satisfied: boolean; status: string };
  if (referral.threshold_satisfied) {
    return { ok: false, error: 'already_satisfied' };
  }
  if (referral.status === 'cancelled' || referral.status === 'expired') {
    return { ok: false, error: 'invalid_status' };
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from('referrals')
    .update({
      threshold_satisfied: true,
      threshold_satisfied_at: nowIso,
      status: 'active',
      updated_at: nowIso,
    })
    .eq('id', args.referral_id);

  if (updateErr) return { ok: false, error: updateErr.message };

  await writeAuditRow(admin, {
    actor_user_id: actorId,
    action: 'force_mark_threshold',
    target_table: 'referrals',
    target_id: args.referral_id,
    override_reason: args.reason,
    payload: { previous_status: referral.status },
  });

  return { ok: true, data: { referral_id: args.referral_id } };
}

// ─── force-cancel accrual ─────────────────────────────────────

export async function forceCancelAccrual(
  admin: SupabaseClient,
  actorId: string,
  args: { accrual_id: string; reason: string },
): Promise<OverrideResult<{ accrual_id: string }>> {
  const reasonErr = validateReason(args.reason);
  if (reasonErr) return { ok: false, error: reasonErr };

  const { data: row, error: lookupErr } = await admin
    .from('referral_commission_accruals')
    .select('id, state, commission_amount_cents, referral_id')
    .eq('id', args.accrual_id)
    .maybeSingle();

  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!row) return { ok: false, error: 'accrual_not_found' };

  const accrual = row as {
    id: string;
    state: string;
    commission_amount_cents: number;
    referral_id: string;
  };
  if (accrual.state !== 'pending') {
    // Released and forfeited accruals are immutable from the admin
    // panel; reversing a released one means a Rewardful adjustment
    // (PR 9), not a state flip here.
    return { ok: false, error: 'invalid_state' };
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from('referral_commission_accruals')
    .update({
      state: 'forfeited',
      forfeited_at: nowIso,
      forfeited_reason: 'admin_override',
    })
    .eq('id', args.accrual_id);

  if (updateErr) return { ok: false, error: updateErr.message };

  // Decrement the parent referral's pending counter so the totals
  // reconcile against (sum of pending accruals).
  const { error: decErr } = await admin.rpc('decrement_pending_commission', {
    p_referral_id: accrual.referral_id,
    p_cents: accrual.commission_amount_cents,
  });
  // RPC may not exist yet (added in PR 9). Fall back to a direct
  // SQL update via the Supabase builder if so. We attempt the
  // builder path on any error from the RPC call.
  if (decErr) {
    const { data: cur } = await admin
      .from('referrals')
      .select('pending_commission_cents')
      .eq('id', accrual.referral_id)
      .maybeSingle();
    if (cur) {
      const next =
        ((cur as { pending_commission_cents: number }).pending_commission_cents ?? 0) -
        accrual.commission_amount_cents;
      await admin
        .from('referrals')
        .update({ pending_commission_cents: Math.max(0, next), updated_at: nowIso })
        .eq('id', accrual.referral_id);
    }
  }

  await writeAuditRow(admin, {
    actor_user_id: actorId,
    action: 'force_cancel_accrual',
    target_table: 'referral_commission_accruals',
    target_id: args.accrual_id,
    override_reason: args.reason,
    payload: {
      previous_state: accrual.state,
      commission_amount_cents: accrual.commission_amount_cents,
      referral_id: accrual.referral_id,
    },
  });

  return { ok: true, data: { accrual_id: args.accrual_id } };
}

// ─── force-create referral ────────────────────────────────────

export async function forceCreateReferral(
  admin: SupabaseClient,
  actorId: string,
  args: {
    advocate_user_id: string;
    referred_user_id: string;
    reason: string;
  },
): Promise<OverrideResult<{ referral_id: string }>> {
  const reasonErr = validateReason(args.reason);
  if (reasonErr) return { ok: false, error: reasonErr };
  if (args.advocate_user_id === args.referred_user_id) {
    return { ok: false, error: 'self_referral' };
  }

  const [advocateResult, referredResult] = await Promise.all([
    admin
      .from('user_profiles')
      .select('id, advocate_state, advocate_onboarded_at')
      .eq('id', args.advocate_user_id)
      .maybeSingle(),
    admin
      .from('user_profiles')
      .select('id, first_paid_at, tier')
      .eq('id', args.referred_user_id)
      .maybeSingle(),
  ]);

  if (advocateResult.error || !advocateResult.data) {
    return { ok: false, error: 'advocate_not_found' };
  }
  if (referredResult.error || !referredResult.data) {
    return { ok: false, error: 'referred_not_found' };
  }

  const advocate = advocateResult.data as {
    id: string;
    advocate_state: string;
    advocate_onboarded_at: string | null;
  };
  const referred = referredResult.data as {
    id: string;
    first_paid_at: string | null;
    tier: string;
  };

  if (advocate.advocate_state !== 'active' && advocate.advocate_state !== 'paused') {
    return { ok: false, error: 'advocate_not_eligible' };
  }
  if (!advocate.advocate_onboarded_at) {
    return { ok: false, error: 'advocate_not_onboarded' };
  }
  if (!referred.first_paid_at) {
    return { ok: false, error: 'referred_never_paid' };
  }

  // Existing referral → no-op (don't double-register).
  const { data: existing } = await admin
    .from('referrals')
    .select('id')
    .eq('advocate_user_id', args.advocate_user_id)
    .eq('referred_user_id', args.referred_user_id)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: 'referral_exists' };
  }

  // Annual cap classification at create time. Counts only this
  // calendar year's commissioned referrals — not lifetime — per
  // spec §2.6.
  const yearStartIso = new Date(
    Date.UTC(new Date().getUTCFullYear(), 0, 1, 0, 0, 0, 0),
  ).toISOString();
  const { count: yearCount } = await admin
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('advocate_user_id', args.advocate_user_id)
    .gte('created_at', yearStartIso);
  const aboveCap = (yearCount ?? 0) >= 30;
  const commissionRate = aboveCap ? 0.35 : 0.5;

  // commissioned_from = MAX(referred.first_paid_at, advocate.advocate_onboarded_at)
  const commissionedFrom =
    new Date(referred.first_paid_at) > new Date(advocate.advocate_onboarded_at)
      ? referred.first_paid_at
      : advocate.advocate_onboarded_at;
  const commissionWindowEnd = addMonths(commissionedFrom, 24);

  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertErr } = await admin
    .from('referrals')
    .insert({
      advocate_user_id: args.advocate_user_id,
      referred_user_id: args.referred_user_id,
      attributed_at: referred.first_paid_at,
      commissioned_from: commissionedFrom,
      commission_window_ends_at: commissionWindowEnd,
      commission_rate: commissionRate,
      commission_duration_months: 24,
      paid_days_streak: 0,
      threshold_satisfied: false,
      threshold_required_days: 60,
      is_above_annual_cap: aboveCap,
      pending_commission_cents: 0,
      released_commission_cents: 0,
      status: 'pre_threshold',
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return { ok: false, error: insertErr?.message ?? 'insert_failed' };
  }

  const referralId = (inserted as { id: string }).id;

  await writeAuditRow(admin, {
    actor_user_id: actorId,
    action: 'force_create_referral',
    target_table: 'referrals',
    target_id: referralId,
    override_reason: args.reason,
    payload: {
      advocate_user_id: args.advocate_user_id,
      referred_user_id: args.referred_user_id,
      commission_rate: commissionRate,
      is_above_annual_cap: aboveCap,
      commissioned_from: commissionedFrom,
      commission_window_ends_at: commissionWindowEnd,
    },
  });

  return { ok: true, data: { referral_id: referralId } };
}

// ─── Audit row writer ─────────────────────────────────────────

type AuditRow = {
  actor_user_id: string;
  action: OverrideAction;
  target_table: 'referrals' | 'referral_commission_accruals';
  target_id: string;
  override_reason: string;
  payload: Record<string, unknown>;
};

async function writeAuditRow(admin: SupabaseClient, row: AuditRow): Promise<void> {
  const { error } = await admin.from('admin_actions').insert(row);
  if (error) {
    // Audit failure is loud — every override must produce a row.
    // We don't roll back the underlying mutation (data is already
    // updated), but we surface so the founder sees the gap.
    console.error('[admin.audit.write_failed]', error.message, row);
  }
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}
