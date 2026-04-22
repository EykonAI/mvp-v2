import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily cron that demotes lapsed crypto subscriptions. Crypto subs are
 * annual-only with no auto-renewal — when current_period_end passes
 * without a renewal payment, the user must drop back to Citizen so the
 * tier gate (Phase A) re-engages on /intel/* and /api/chat.
 *
 * Two transitions:
 *   1. subscriptions row: status='active' → status='expired'
 *   2. user_profiles: tier=<previous> → tier='citizen', billing_cycle=NULL
 *
 * Idempotent: only operates on rows where current_period_end <= now and
 * status is still 'active'. Re-running is a no-op once the row is expired.
 *
 * Lemon Squeezy subs are excluded — the LS webhook handles its own
 * cancellation/expiry transitions when the Phase 5 integration ships.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const admin = createServerSupabase();
  const nowIso = new Date().toISOString();

  // Fetch the candidate set first so we can attribute the user_profiles
  // updates back to specific rows. Limit to 200 to keep the per-tick
  // workload bounded; if more than 200 lapse in a single 24h window we
  // catch them on the next tick.
  const { data: lapsed, error: fetchError } = await admin
    .from('subscriptions')
    .select('id, user_id, tier, current_period_end, payment_provider')
    .eq('payment_provider', 'nowpayments')
    .eq('status', 'active')
    .lte('current_period_end', nowIso)
    .order('current_period_end', { ascending: true })
    .limit(200);

  if (fetchError) {
    console.error('[expire-subscriptions] fetch failed', fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const results = {
    candidates: lapsed?.length ?? 0,
    expired_subscriptions: 0,
    demoted_users: 0,
    failed: 0,
  };

  for (const sub of lapsed ?? []) {
    // Mark the subscription expired. Doing this first means a concurrent
    // /api/billing/cancel from the user can't race us — they'll get a 409
    // (status not 'active') and bounce out cleanly.
    const { error: subError } = await admin
      .from('subscriptions')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', sub.id)
      .eq('status', 'active'); // belt: only flip if still active
    if (subError) {
      console.error('[expire-subscriptions] subscription update failed', sub.id, subError.message);
      results.failed++;
      continue;
    }
    results.expired_subscriptions++;

    // Demote the user_profile only if no OTHER active subscription exists
    // for them (defensive — a user shouldn't have two active subs but if
    // they do, don't strip access from a still-paying user).
    const { count } = await admin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', sub.user_id)
      .eq('status', 'active');
    if ((count ?? 0) > 0) continue;

    const { error: profileError } = await admin
      .from('user_profiles')
      .update({
        tier: 'citizen',
        billing_cycle: null,
        updated_at: nowIso,
      })
      .eq('id', sub.user_id);
    if (profileError) {
      console.error('[expire-subscriptions] profile demote failed', sub.user_id, profileError.message);
      results.failed++;
      continue;
    }
    results.demoted_users++;
  }

  return NextResponse.json(results);
}
