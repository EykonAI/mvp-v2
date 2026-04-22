import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { captureServer } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/cancel
 * Body: { subscription_id: string }
 *
 * "Cancel" for crypto subscriptions means "don't auto-renew". Access stays
 * active through current_period_end. We set `cancel_at = current_period_end`
 * as a signal to the renewal-reminder cron (which checks cancel_at IS NULL
 * before firing the 30/7/1-day nudges) and keep status='active' so the
 * feature gate keeps unlocking the Intelligence Center until the period
 * ends. A follow-up cron (deferred — Phase G or beyond) will transition
 * status='expired' once current_period_end passes.
 *
 * For Lemon Squeezy subs, cancellation MUST happen in the LS portal so the
 * card-on-file is properly detached upstream — this route rejects with a
 * clear message pointing the user there.
 */
export async function POST(request: NextRequest) {
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

  const subscriptionId =
    body && typeof body === 'object' && 'subscription_id' in body
      ? String((body as { subscription_id: unknown }).subscription_id || '')
      : '';
  if (!subscriptionId) {
    return NextResponse.json({ error: 'subscription_id is required' }, { status: 400 });
  }

  const admin = createServerSupabase();

  const { data: sub, error: fetchError } = await admin
    .from('subscriptions')
    .select('id, user_id, payment_provider, tier, status, current_period_end, cancel_at')
    .eq('id', subscriptionId)
    .single();

  if (fetchError || !sub) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }
  if (sub.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (sub.status !== 'active') {
    return NextResponse.json(
      { error: `Subscription is not active (status: ${sub.status})` },
      { status: 409 },
    );
  }
  if (sub.cancel_at) {
    return NextResponse.json(
      { error: 'Subscription is already set to not renew', cancel_at: sub.cancel_at },
      { status: 409 },
    );
  }
  if (sub.payment_provider === 'lemon_squeezy') {
    return NextResponse.json(
      {
        error:
          'Fiat cancellation must be done in the Lemon Squeezy billing portal. Email support@eykon.ai for the direct link while LS integration is finalising.',
      },
      { status: 409 },
    );
  }

  const { error: updateError } = await admin
    .from('subscriptions')
    .update({
      cancel_at: sub.current_period_end,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  void captureServer(user.id, {
    event: 'cancel_clicked',
    from_tier: sub.tier,
  });

  return NextResponse.json({
    ok: true,
    cancel_at: sub.current_period_end,
  });
}
