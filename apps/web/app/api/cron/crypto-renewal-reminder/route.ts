import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';
import { sendCryptoRenewalReminder } from '@/lib/email/send';
import { formatUsd, getCryptoVariant } from '@/lib/pricing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily cron that finds active crypto subscriptions renewing within a
 * reminder window and sends each user a payment-ready nudge. Three windows
 * fire per subscription across its lifetime: 30 days, 7 days, and 1 day
 * before current_period_end. The email_log table prevents duplicate sends
 * at each window (idempotent via a "same template to same user within 24h"
 * check).
 */
const WINDOWS_DAYS = [30, 7, 1] as const;

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const admin = createServerSupabase();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const results = {
    windows_processed: 0,
    candidates: 0,
    sent: 0,
    already_reminded: 0,
    failed: 0,
  };

  for (const days of WINDOWS_DAYS) {
    results.windows_processed++;
    const target = new Date(today);
    target.setUTCDate(target.getUTCDate() + days);
    const targetStart = new Date(target);
    const targetEnd = new Date(target);
    targetEnd.setUTCHours(23, 59, 59, 999);

    const { data: subs, error } = await admin
      .from('subscriptions')
      .select('id, user_id, variant_id, tier, billing_cycle, status, current_period_end')
      .eq('payment_provider', 'nowpayments')
      .eq('status', 'active')
      .eq('billing_cycle', 'annual')
      .gte('current_period_end', targetStart.toISOString())
      .lte('current_period_end', targetEnd.toISOString());

    if (error) {
      console.error('[renewal-reminder] fetch failed', error.message);
      continue;
    }

    for (const sub of subs ?? []) {
      results.candidates++;

      // Idempotency: don't re-send the same window reminder if we've already
      // emailed this user with the renewal template in the last 24h.
      const { data: recent } = await admin
        .from('email_log')
        .select('id')
        .eq('user_id', sub.user_id)
        .eq('template', 'crypto_renewal_reminder')
        .gte('created_at', new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString())
        .limit(1);
      if (recent && recent.length > 0) {
        results.already_reminded++;
        continue;
      }

      const { data: profile } = await admin
        .from('user_profiles')
        .select('id, email')
        .eq('id', sub.user_id)
        .single();
      if (!profile?.email) continue;

      const variant = getCryptoVariant(sub.variant_id);
      const amountCents = variant?.crypto_total_usd_cents ?? 0;
      const amountUsd = amountCents > 0 ? formatUsd(amountCents) : '—';
      const renewalUrl = `https://mvp.eykon.ai/checkout?plan=${encodeURIComponent(sub.variant_id)}&renew=1`;

      const result = await sendCryptoRenewalReminder({
        to: profile.email,
        userId: profile.id,
        tierLabel: sub.tier.charAt(0).toUpperCase() + sub.tier.slice(1),
        daysUntilRenewal: days,
        currentPeriodEndIso: sub.current_period_end,
        renewalCheckoutUrl: renewalUrl,
        amountUsd,
      });

      if (result.state === 'error') {
        results.failed++;
      } else {
        results.sent++;
      }
    }
  }

  return NextResponse.json(results);
}
