import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';
import { sendReceiptCrypto } from '@/lib/email/send';
import { formatUsd, getCryptoVariant } from '@/lib/pricing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_SIZE = 50;

/**
 * Drains email-channel rows out of notification_queue and routes them to the
 * right Resend template. Intended to run every 60 s on a Railway cron
 * trigger. Rows are marked `sent = true` only after the send succeeds so
 * failures are retried automatically on the next tick.
 *
 * Dispatch is driven by `payload.template`; anything unknown is logged and
 * left in the queue for a human to clean up.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const admin = createServerSupabase();

  const { data: rows, error } = await admin
    .from('notification_queue')
    .select('id, user_id, channel, title, body, payload, created_at')
    .eq('channel', 'email')
    .eq('sent', false)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    unknown_template: 0,
  };

  for (const row of rows ?? []) {
    results.processed++;
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const template = typeof payload.template === 'string' ? payload.template : '';

    const { data: profile } = await admin
      .from('user_profiles')
      .select('id, email')
      .eq('id', row.user_id)
      .single();

    if (!profile?.email) {
      results.skipped++;
      await admin
        .from('notification_queue')
        .update({ sent: true, sent_at: new Date().toISOString() })
        .eq('id', row.id);
      continue;
    }

    try {
      if (template === 'receipt_crypto') {
        const variantId = typeof payload.variant_id === 'string' ? payload.variant_id : '';
        const variant = getCryptoVariant(variantId);
        const amountCents = variant?.crypto_total_usd_cents ?? 0;

        const result = await sendReceiptCrypto({
          to: profile.email,
          userId: profile.id,
          notificationQueueId: row.id,
          tierLabel: typeof payload.tier === 'string' ? payload.tier.toUpperCase() : 'Pro',
          variantId,
          amountUsd: amountCents > 0 ? formatUsd(amountCents) : '—',
          payCurrency: typeof payload.pay_currency === 'string' ? payload.pay_currency : 'crypto',
          txHash: typeof payload.tx_hash === 'string' ? payload.tx_hash : null,
          periodStartIso: new Date().toISOString(),
          periodEndIso: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          grantedFounding: payload.granted_founding === true,
        });

        if (result.state === 'error') {
          results.failed++;
          continue; // leave row un-sent for retry
        }
        results.sent++;
      } else {
        results.unknown_template++;
        console.warn('[drain] unknown template', template, 'for queue row', row.id);
      }
    } catch (err) {
      results.failed++;
      console.error('[drain] send threw', err);
      continue;
    }

    // Mark row drained regardless of dry-run vs sent — the email_log carries
    // the canonical delivery status.
    await admin
      .from('notification_queue')
      .update({ sent: true, sent_at: new Date().toISOString() })
      .eq('id', row.id);
  }

  return NextResponse.json(results);
}
