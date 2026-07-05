import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCryptoVariant, getPassProduct, type PassProduct } from '@/lib/pricing';
import { getCurrentTier } from '@/lib/subscription';
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

  // Optional Rewardful affiliate id passed from the browser. Persisted in
  // the NOWPayments order_description so it survives the round-trip to the
  // webhook; the complete_crypto_purchase flow can match it against an
  // affiliate for Week-2 payout reconciliation.
  const rewardfulReferral =
    body && typeof body === 'object' && 'rewardful_referral' in body
      ? String((body as { rewardful_referral: unknown }).rewardful_referral || '').slice(0, 64)
      : '';

  // One-off passes & packs (mig 075) take a separate, simpler path:
  // no subscription guard for packs, no founding logic, purchase kind
  // routes the webhook to lib/payments/passes.ts.
  const passProduct = getPassProduct(variantId);
  if (passProduct) {
    return await checkoutPass(request, user.id, passProduct);
  }

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

  const orderDescription = rewardfulReferral
    ? `eYKON.ai · ${variant.label} · rw:${rewardfulReferral}`
    : `eYKON.ai · ${variant.label}`;

  try {
    const invoice = await createNowpaymentsInvoice({
      price_amount: priceMajorUnits,
      price_currency: variant.crypto_price_currency,
      order_id: pending.id,
      order_description: orderDescription,
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

// One-off pass/pack checkout (monetisation review §4.4). Differences
// from the subscription path: packs are allowed alongside an active
// subscription (a Pro user can buy a query pack); the Week Pass is
// pointless at pro+ and is refused with a friendly message; the
// purchase row carries the pass kind so the webhook routes completion
// to completePassPurchase instead of the tier-granting RPC.
async function checkoutPass(request: NextRequest, userId: string, product: PassProduct) {
  const admin = createServerSupabase();

  if (product.kind === 'week_pass') {
    const tier = await getCurrentTier();
    if (tier === 'pro' || tier === 'desk' || tier === 'enterprise') {
      return NextResponse.json(
        { error: 'You already have full access — the Week Pass is for Citizen and Member accounts.' },
        { status: 409 },
      );
    }
  }

  const { data: pending, error: pendingErr } = await admin
    .from('purchases')
    .insert({
      user_id: userId,
      payment_provider: 'nowpayments',
      variant_id: product.id,
      kind: product.kind,
      status: 'pending',
      amount_cents: product.usd_cents,
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

  const appUrl = resolveAppUrl(request);
  const priceMajorUnits = product.usd_cents / 100;
  try {
    const invoice = await createNowpaymentsInvoice({
      price_amount: priceMajorUnits,
      price_currency: 'usd',
      order_id: pending.id,
      order_description: `eYKON.ai · ${product.label}`,
      ipn_callback_url: `${appUrl}/api/webhooks/nowpayments`,
      success_url: `${appUrl}/app?payment=crypto_success&variant=${product.id}`,
      cancel_url: `${appUrl}/pricing?payment=cancelled`,
      is_fixed_rate: true,
      is_fee_paid_by_user: true,
    });
    void captureServer(userId, {
      event: 'checkout_started',
      plan: product.id,
      payment_method: 'crypto',
      amount_usd_cents: product.usd_cents,
    });
    return NextResponse.json({
      invoice_url: invoice.invoice_url,
      invoice_id: invoice.id,
      purchase_id: pending.id,
      amount_usd: priceMajorUnits,
      seats: 1,
    });
  } catch (err) {
    await admin
      .from('purchases')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', pending.id);
    const message = err instanceof Error ? err.message : 'NOWPayments invoice creation failed';
    void captureServer(userId, {
      event: 'checkout_failed',
      plan: product.id,
      payment_method: 'crypto',
      reason: message.slice(0, 200),
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
