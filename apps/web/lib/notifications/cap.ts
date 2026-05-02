import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tier } from '@/lib/auth/session';

// Per-user monthly cap on SMS + WhatsApp combined (brief §10):
//   Pro          50
//   Desk        200
//   Enterprise  1000
// Email is never capped.
//
// Enforcement is a hybrid:
//   • Soft-warn email at  80 % of cap (once per calendar month).
//   • HARD STOP at       150 % of cap — dispatcher refuses to send
//     SMS / WhatsApp until the next billing period. Email leg still
//     goes; the cron writes a log row capturing the suppression so
//     the user can see *why* an expected SMS never landed.
//
// Per-rule per-day rate limit (20 fires / 24 h) is a separate gate
// applied by the cron *before* the fire happens — see
// findRecentFireCount() below.

export const SMS_WA_MONTHLY_CAPS: Record<Tier, number> = {
  citizen: 0,
  pro: 50,
  desk: 200,
  enterprise: 1000,
};

export const SOFT_WARN_RATIO = 0.8;
export const HARD_STOP_RATIO = 1.5;

export const PER_RULE_PER_DAY_FIRE_LIMIT = 20;

/**
 * Format the current calendar month as 'YYYY-MM' in UTC. Caps are
 * scoped to UTC months — keeps a user near a timezone boundary from
 * gaming the threshold by waiting a few hours.
 */
export function currentPeriodYm(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Count successful SMS + WhatsApp dispatches for the user in the
 * current calendar month. Reads delivery_status JSON on the log
 * rows — anything that returned ok=true via provider 'twilio' (SMS
 * or WhatsApp) counts toward the cap.
 *
 * Email rows are not counted (cap is SMS + WhatsApp only).
 */
export async function getMonthlySmsWaCount(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const { data, error } = await supabase
    .from('user_notification_log')
    .select('delivery_status, channel_ids')
    .eq('user_id', userId)
    .gte('fired_at', startOfMonth.toISOString())
    .limit(2000);
  if (error || !data) return 0;

  let count = 0;
  for (const row of data) {
    const ds = (row.delivery_status ?? {}) as Record<string, { ok?: boolean; provider?: string }>;
    for (const result of Object.values(ds)) {
      if (result?.ok === true && result.provider === 'twilio') count++;
    }
  }
  return count;
}

/**
 * Decide whether a given channel-type dispatch is allowed under the
 * monthly cap. Email is unbounded. SMS / WhatsApp share the cap.
 *
 * The "incoming" parameter is how many of this same dispatch we're
 * about to make (always 1 from the per-channel dispatch loop). The
 * function returns "would_exceed_hard_stop" so the caller can record
 * the suppression with a precise reason.
 */
export type CapDecision =
  | { gate: 'allow' }
  | { gate: 'soft_warn'; count: number; cap: number }
  | { gate: 'hard_stop'; count: number; cap: number };

export function decideCapGate(
  channelType: 'email' | 'sms' | 'whatsapp',
  monthlyCount: number,
  cap: number,
): CapDecision {
  if (channelType === 'email') return { gate: 'allow' };
  if (cap <= 0) return { gate: 'hard_stop', count: monthlyCount, cap };
  // After this dispatch the new count would be monthlyCount + 1.
  const projected = monthlyCount + 1;
  if (projected >= cap * HARD_STOP_RATIO) {
    return { gate: 'hard_stop', count: monthlyCount, cap };
  }
  if (projected >= cap * SOFT_WARN_RATIO) {
    return { gate: 'soft_warn', count: monthlyCount, cap };
  }
  return { gate: 'allow' };
}

// ─── Per-rule rate limit (20 / 24 h) ─────────────────────────────

/**
 * Count fires for this rule in the trailing N hours. Used by both
 * cron routes to short-circuit a runaway rule before it fires for
 * the 21st time in a day.
 */
export async function findRecentFireCount(
  supabase: SupabaseClient,
  ruleId: string,
  hours = 24,
): Promise<number> {
  const since = new Date(Date.now() - hours * 60 * 60_000).toISOString();
  const { count } = await supabase
    .from('user_notification_log')
    .select('id', { count: 'exact', head: true })
    .eq('rule_id', ruleId)
    .gte('fired_at', since);
  return count ?? 0;
}

// ─── Soft-warn state ─────────────────────────────────────────────

/**
 * True iff a soft-warn email has already been issued for the user in
 * the current period. Drives idempotency of the warning send.
 */
export async function wasWarnedThisPeriod(
  supabase: SupabaseClient,
  userId: string,
  ym: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('user_notif_billing_state')
    .select('warned_for_period')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.warned_for_period === ym;
}

/**
 * Mark the soft-warn email as sent for this period. Upsert so first-
 * time users get a row created automatically.
 */
export async function markWarned(
  supabase: SupabaseClient,
  userId: string,
  ym: string,
): Promise<void> {
  await supabase
    .from('user_notif_billing_state')
    .upsert(
      {
        user_id: userId,
        warned_for_period: ym,
        warned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
}
