import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dispatchToChannel,
  sendCapWarningEmail,
  type DispatchOutcome,
  type FirePayload,
  type VerifiedChannel,
} from './dispatch';
import {
  SMS_WA_MONTHLY_CAPS,
  currentPeriodYm,
  decideCapGate,
  getMonthlySmsWaCount,
  markWarned,
  wasWarnedThisPeriod,
} from './cap';
import type { Tier } from '@/lib/auth/session';

// Cap-aware per-channel dispatch loop, shared between the cheap cron
// and the AI cron. For each channel id the rule references:
//   1. Resolve to a verified-and-active user_channels row. Drop
//      otherwise with a discriminated suppressed_reason.
//   2. Apply the SMS + WhatsApp monthly cap (Pro 50, Desk 200,
//      Enterprise 1000):
//        • allow      → dispatch
//        • soft_warn  → dispatch + queue a once-per-month warning
//        • hard_stop  → suppressed_reason='monthly_cap_hard_stop'
//   3. Email is never gated by the cap — it always goes through.
//
// At the end, if soft_warn fired and the user hasn't been warned
// this calendar month, send the warning email and mark the state.

interface DispatchCtx {
  supabase: SupabaseClient;
  userId: string;
  userTier: Tier;
  userEmail: string | null;
  rule: { channel_ids: string[] };
  payload: FirePayload;
  channelRows: Array<
    VerifiedChannel & { verified_at: string | null }
  >;
}

export interface DispatchSummary {
  delivery_status: Record<string, DispatchOutcome>;
  /** Pre-fire monthly count (informational; surfaced for telemetry). */
  monthly_sms_wa_count: number;
  /** True if this fire crossed into soft-warn territory. */
  soft_warn_triggered: boolean;
  /** True if the warning email was sent during this dispatch. */
  warning_email_sent: boolean;
}

export async function dispatchWithCap(ctx: DispatchCtx): Promise<DispatchSummary> {
  const cap = SMS_WA_MONTHLY_CAPS[ctx.userTier] ?? 0;
  // Snapshot count once per fire — fine because the dispatcher
  // serialises within a single rule's fire and the cap is evaluated
  // per-projected-dispatch.
  let runningCount = await getMonthlySmsWaCount(ctx.supabase, ctx.userId);
  let softWarnTriggered = false;

  const deliveryStatus: Record<string, DispatchOutcome> = {};

  for (const channelId of ctx.rule.channel_ids) {
    const row = ctx.channelRows.find(c => c.id === channelId);
    if (!row) {
      deliveryStatus[channelId] = {
        ok: false,
        error: 'channel_not_found',
        suppressed_reason: 'channel_deleted_or_inaccessible',
      };
      continue;
    }
    if (!row.verified_at) {
      deliveryStatus[channelId] = {
        ok: false,
        error: 'channel_unverified',
        suppressed_reason: 'channel_unverified',
      };
      continue;
    }
    if (!row.active) {
      deliveryStatus[channelId] = {
        ok: false,
        error: 'channel_paused',
        suppressed_reason: 'channel_paused',
      };
      continue;
    }

    const decision = decideCapGate(row.channel_type, runningCount, cap);
    if (decision.gate === 'hard_stop') {
      deliveryStatus[channelId] = {
        ok: false,
        error: 'monthly_cap_hard_stop',
        suppressed_reason: `monthly_cap_hard_stop_${decision.count}/${decision.cap}`,
      };
      continue;
    }
    if (decision.gate === 'soft_warn') {
      softWarnTriggered = true;
    }

    const outcome = await dispatchToChannel(row, ctx.payload);
    deliveryStatus[channelId] = outcome;
    if (outcome.ok && (row.channel_type === 'sms' || row.channel_type === 'whatsapp')) {
      // Only successful Twilio sends count toward the cap — failures
      // (auth, rate-limit, bad number) are not billed.
      if (outcome.provider === 'twilio') runningCount += 1;
    }
  }

  let warningEmailSent = false;
  if (softWarnTriggered && ctx.userEmail) {
    const ym = currentPeriodYm();
    const alreadyWarned = await wasWarnedThisPeriod(ctx.supabase, ctx.userId, ym);
    if (!alreadyWarned) {
      const result = await sendCapWarningEmail(ctx.userEmail, {
        tierLabel: tierLabel(ctx.userTier),
        count: runningCount,
        cap,
        periodYm: ym,
      });
      if (result.ok) {
        await markWarned(ctx.supabase, ctx.userId, ym);
        warningEmailSent = true;
      }
    }
  }

  return {
    delivery_status: deliveryStatus,
    monthly_sms_wa_count: runningCount,
    soft_warn_triggered: softWarnTriggered,
    warning_email_sent: warningEmailSent,
  };
}

function tierLabel(tier: Tier): string {
  if (tier === 'pro') return 'Pro';
  if (tier === 'desk') return 'Desk';
  if (tier === 'enterprise') return 'Enterprise';
  return 'Citizen';
}
