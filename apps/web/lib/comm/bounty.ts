import type { SupabaseClient } from '@supabase/supabase-js';

// Creator conversion bounty (monetisation review §4.2, mig 073).
//
// Attribution rule (decided in the 2026-07-04 build-prompt): at the
// moment a platform upgrade completes, the converted user's ACTIVE
// paid-Space subscriptions are looked up; the creator of the
// EARLIEST-JOINED one earns the bounty. No active Space membership →
// no bounty. One bounty per converted user, ever — enforced by the
// UNIQUE(converted_user_id) constraint, so webhook retries and later
// re-subscriptions can never double-pay.

export const DEFAULT_BOUNTY_RATE_BPS = 2500; // 25% of first-year revenue

export function getBountyRateBps(): number {
  const raw = process.env.BOUNTY_RATE_BPS;
  if (!raw) return DEFAULT_BOUNTY_RATE_BPS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? Math.round(n) : DEFAULT_BOUNTY_RATE_BPS;
}

export type BountyRecordInput = {
  convertedUserId: string;
  planVariant: string;
  // What the user actually paid, in USD cents (crypto-discounted).
  baseAmountUsdCents: number;
};

// Called from the NOWPayments webhook after complete_crypto_purchase
// succeeds. MUST NEVER THROW — a bounty-ledger hiccup must not fail a
// confirmed payment, so every exit path here is a log line, not an
// exception. `admin` is the service-role client (creator_bounties is
// RLS-no-policy).
export async function recordConversionBounty(
  admin: SupabaseClient,
  input: BountyRecordInput,
): Promise<void> {
  try {
    const { data: subs, error: subsErr } = await admin
      .from('comm_space_subscriptions')
      .select('space_id, created_at, comm_spaces!inner(creator_id)')
      .eq('subscriber_id', input.convertedUserId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(5);
    if (subsErr) {
      console.error('[bounty] subscription lookup failed', subsErr.message);
      return;
    }
    if (!subs || subs.length === 0) return; // organic upgrade — no bounty

    // Earliest-joined Space whose creator is not the converting user
    // (self-conversion earns nothing).
    const attributed = subs.find(s => {
      const creator = (s as any).comm_spaces?.creator_id;
      return creator && creator !== input.convertedUserId;
    });
    if (!attributed) return;
    const creatorId = (attributed as any).comm_spaces.creator_id as string;

    const bountyUsdCents = Math.round(
      (input.baseAmountUsdCents * getBountyRateBps()) / 10_000,
    );

    const { error: insErr } = await admin.from('creator_bounties').insert({
      creator_user_id: creatorId,
      converted_user_id: input.convertedUserId,
      space_id: attributed.space_id,
      plan_variant: input.planVariant,
      base_amount_usd_cents: input.baseAmountUsdCents,
      bounty_usd_cents: bountyUsdCents,
    });
    if (insErr) {
      // 23505 = unique_violation: this user already produced a bounty
      // (webhook retry or a later plan change) — by design, not an error.
      if ((insErr as { code?: string }).code === '23505') return;
      console.error('[bounty] insert failed', insErr.message);
      return;
    }
    console.log(
      `[bounty] recorded ${bountyUsdCents}¢ for creator ${creatorId} (space ${attributed.space_id}, variant ${input.planVariant})`,
    );
  } catch (err) {
    console.error('[bounty] unexpected', err instanceof Error ? err.message : err);
  }
}

// ─── Creator earnings (server-rendered panel on the Manage view) ───

export type CreatorBountyRow = {
  id: string;
  space_id: string;
  plan_variant: string;
  bounty_usd_cents: number;
  status: 'pending' | 'approved' | 'paid' | 'void';
  created_at: string;
  paid_at: string | null;
};

export type CreatorEarnings = {
  rows: CreatorBountyRow[];
  pendingUsdCents: number; // pending + approved
  paidUsdCents: number;
};

export async function loadCreatorEarnings(
  admin: SupabaseClient,
  creatorId: string,
): Promise<CreatorEarnings> {
  const { data, error } = await admin
    .from('creator_bounties')
    .select('id, space_id, plan_variant, bounty_usd_cents, status, created_at, paid_at')
    .eq('creator_user_id', creatorId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) {
    if (error) console.error('[bounty] earnings load failed', error.message);
    return { rows: [], pendingUsdCents: 0, paidUsdCents: 0 };
  }
  const rows = data as CreatorBountyRow[];
  const sum = (statuses: string[]) =>
    rows.filter(r => statuses.includes(r.status)).reduce((a, r) => a + r.bounty_usd_cents, 0);
  return {
    rows,
    pendingUsdCents: sum(['pending', 'approved']),
    paidUsdCents: sum(['paid']),
  };
}
