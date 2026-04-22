import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCryptoVariant } from '@/lib/pricing';
import { createNowpaymentsInvoice } from '@/lib/payments/nowpayments';
import { captureServer } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

function resolveAppUrl(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return request.nextUrl.origin;
}

/**
 * POST /api/checkout/nowpayments
 * Body: { variant: 'pro_founding_annual' | 'pro_standard_annual' }
 *
 * 1. Auth check (user must be signed in; unauthenticated → 401).
 * 2. Validate variant against the crypto allow-list.
 * 3. Insert a pending `purchases` row (service role; RLS blocks inserts from
 *    the user's own context so the handler owns the write).
 * 4. Call NOWPayments /invoice with our purchase UUID as `order_id`.
 * 5. Return the hosted-invoice URL. Frontend redirects the user to it.
 *
 * The webhook handler resolves user + variant from the purchase row using
 * the UUID, so we never have to parse composite order IDs.
 */
export async function POST(request: NextRequest) {
  if (process.env.SIGNUPS_PAUSED === 'true') {
    return NextResponse.json(
      { error: 'Signups are temporarily paused. Please try again shortly.' },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const variantId =
    body && typeof body === 'object' && 'variant' in body
      ? String((body as { variant: unknown }).variant || '')
      : '';

  const variant = getCryptoVariant(variantId);
  if (!variant) {
    return NextResponse.json(
      { error: `Unknown or non-crypto variant: ${variantId}` },
      { status: 400 },
    );
  }

  // 1. Guard against double-subscribing. If the user already has an
  //    active subscription, we don't want to take another payment — they
  //    should manage the existing one via the billing portal.
  const supabase = getServerSupabase();
  const { data: activeSub } = await supabase
    .from('subscriptions')
    .select('id, status, tier')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (activeSub) {
    return NextResponse.json(
      {
        error:
          'You already have an active subscription. Manage it from /billing — crypto top-ups for existing subscriptions are not supported.',
      },
      { status: 409 },
    );
  }

  // 2. Insert the pending purchase. Service-role client bypasses RLS.
  const admin = createServerSupabase();
  const priceMajorUnits = variant.crypto_total_usd_cents / 100;

  const { data: pending, error: pendingErr } = await admin
    .from('purchases')
    .insert({
      user_id: user.id,
      payment_provider: 'nowpayments',
      variant_id: variant.id,
      kind: 'subscription_first',
      status: 'pending',
      amount_cents: variant.crypto_total_usd_cents,
      currency: 'USD',
    })
    .select('id')
    .single();

  if (pendingErr || !pending) {
    return NextResponse.json(
      { error: `Could not create purchase record: ${pendingErr?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  // 3. Build URLs NOWPayments will redirect to / post to.
  const appUrl = resolveAppUrl(request);
  const ipnCallbackUrl = `${appUrl}/api/webhooks/nowpayments`;
  const successUrl = `${appUrl}/app?payment=crypto_success&variant=${variant.id}`;
  const cancelUrl = `${appUrl}/pricing?payment=cancelled`;

  try {
    const invoice = await createNowpaymentsInvoice({
      price_amount: priceMajorUnits,
      price_currency: variant.crypto_price_currency,
      order_id: pending.id,
      order_description: `eYKON.ai · ${variant.label}`,
      ipn_callback_url: ipnCallbackUrl,
      success_url: successUrl,
      cancel_url: cancelUrl,
      is_fixed_rate: true,
      is_fee_paid_by_user: true,
    });

    void captureServer(user.id, {
      event: 'checkout_started',
      plan: variant.id,
      payment_method: 'crypto',
      amount_usd_cents: variant.crypto_total_usd_cents,
    });

    return NextResponse.json({
      invoice_url: invoice.invoice_url,
      invoice_id: invoice.id,
      purchase_id: pending.id,
      amount_usd: priceMajorUnits,
      seats: variant.seats,
    });
  } catch (err) {
    // Roll the purchase back to status='failed' so we don't leave orphans.
    await admin
      .from('purchases')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', pending.id);
    const message = err instanceof Error ? err.message : 'NOWPayments invoice creation failed';
    void captureServer(user.id, {
      event: 'checkout_failed',
      plan: variant.id,
      payment_method: 'crypto',
      reason: message.slice(0, 200),
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
