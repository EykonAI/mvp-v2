import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { verifyNowpaymentsIpn } from '@/lib/payments/signatures';
import {
  recordWebhookReceipt,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/payments/idempotency';
import {
  type NowpaymentsIpnPayload,
  extractCryptoTxHash,
} from '@/lib/payments/nowpayments';
import { captureServer } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

/**
 * NOWPayments IPN callback.
 *
 * Order of operations:
 *   1. Read the raw body (required for HMAC verification).
 *   2. Verify the `x-nowpayments-sig` header against NOWPAYMENTS_IPN_SECRET.
 *   3. Insert into webhook_events keyed by (nowpayments, payment_id). On
 *      unique-violation return 200 silently.
 *   4. Inspect payment_status. For anything but 'finished', just record
 *      and acknowledge — we wait for the terminal event.
 *   5. On 'finished', call the complete_crypto_purchase Postgres function
 *      (atomic: claims founding seat, flips purchase.status, inserts
 *      subscription, updates user_profiles, enqueues welcome email).
 *   6. Mark the webhook_events row as processed.
 */
export async function POST(request: NextRequest) {
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!ipnSecret) {
    console.error('[nowpayments] NOWPAYMENTS_IPN_SECRET missing');
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const sig = request.headers.get('x-nowpayments-sig');

  if (!verifyNowpaymentsIpn(rawBody, sig, ipnSecret)) {
    console.warn('[nowpayments] signature rejected');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: NowpaymentsIpnPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const eventId = String(payload.payment_id ?? '');
  if (!eventId) {
    return NextResponse.json({ error: 'missing payment_id' }, { status: 400 });
  }

  const admin = createServerSupabase();

  // Idempotency — insert a pending row. Duplicate deliveries short-circuit.
  let webhookRowId: string;
  try {
    const receipt = await recordWebhookReceipt(
      admin,
      'nowpayments',
      eventId,
      payload.payment_status,
      payload,
    );
    if (receipt.state === 'duplicate') {
      return NextResponse.json({ status: 'duplicate' });
    }
    webhookRowId = receipt.rowId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'webhook_events insert failed';
    console.error('[nowpayments] idempotency failure', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Non-terminal statuses: record and wait for 'finished'.
  const nonTerminal = ['waiting', 'confirming', 'confirmed', 'sending'];
  if (nonTerminal.includes(payload.payment_status)) {
    await markWebhookProcessed(admin, webhookRowId);
    return NextResponse.json({ status: 'acknowledged', payment_status: payload.payment_status });
  }

  if (payload.payment_status === 'finished') {
    try {
      // Use price_amount (the USD invoice total we locked at creation time —
      // price_currency is always 'usd' for our variants), NOT actually_paid,
      // which NOWPayments reports in the pay currency (crypto amount like
      // 0.012 BTC). Multiplying a crypto amount by 100 would record nonsense
      // cents on the purchase row.
      const amountUsdCents = Math.round(payload.price_amount * 100);
      const { data, error } = await admin.rpc('complete_crypto_purchase', {
        p_purchase_id: payload.order_id,
        p_external_order_id: String(payload.payment_id),
        p_pay_currency: payload.pay_currency,
        p_tx_hash: extractCryptoTxHash(payload),
        p_actually_paid_cents: amountUsdCents,
      });
      if (error) {
        await markWebhookFailed(admin, webhookRowId, error.message);
        console.error('[nowpayments] RPC failed', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      await markWebhookProcessed(admin, webhookRowId);

      // data is the SETOF returned by complete_crypto_purchase; grab the
      // single row and fire the conversion event.
      const completion = Array.isArray(data) ? data[0] : data;
      if (completion?.user_id) {
        void captureServer(completion.user_id, {
          event: 'checkout_succeeded',
          plan: completion.variant_id ?? '',
          payment_method: 'crypto',
          amount_usd_cents: amountUsdCents,
          founding_locked: completion.granted_founding === true,
        });
      }

      return NextResponse.json({ status: 'completed', result: data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'RPC threw';
      await markWebhookFailed(admin, webhookRowId, msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Terminal negative statuses: mark the purchase failed/refunded so the
  // user sees the right message in /billing. No tier grant.
  if (
    payload.payment_status === 'failed' ||
    payload.payment_status === 'expired' ||
    payload.payment_status === 'refunded' ||
    payload.payment_status === 'partially_paid'
  ) {
    const nextStatus =
      payload.payment_status === 'refunded'
        ? 'refunded'
        : payload.payment_status === 'expired'
        ? 'expired'
        : 'failed';
    const { error } = await admin
      .from('purchases')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', payload.order_id);
    if (error) {
      await markWebhookFailed(admin, webhookRowId, error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await markWebhookProcessed(admin, webhookRowId);
    return NextResponse.json({ status: 'terminal', final: nextStatus });
  }

  // Unknown status — log but don't fail the delivery (NOWPayments retries).
  await markWebhookProcessed(admin, webhookRowId);
  return NextResponse.json({ status: 'unknown_state', payment_status: payload.payment_status });
}
