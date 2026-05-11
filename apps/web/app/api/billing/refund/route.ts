import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { captureServer } from '@/lib/analytics/server';

// POST /api/billing/refund — user-initiated refund request.
//
// Flow (trial-mechanism brief §6):
//   1. Resolve caller from session.
//   2. Find the most recent completed purchase for this user.
//   3. Eligibility checks:
//        a. Purchase is within 14 days (REFUND_WINDOW_DAYS).
//        b. User has no prior non-rejected refund request (lifetime cap).
//   4. Insert refund_requests row { status: 'pending' }. Unique index
//      on purchase_id makes double-click harmless (returns existing row).
//   5. Fire PostHog refund_requested event.
//   6. Return { ok, refund_request_id, eta_business_days: 5 }.
//
// Settlement (USDC) happens manually via /admin/refunds. This route
// does NOT touch user_profiles.tier or subscriptions.status — those
// transition only when the operator marks the refund sent.

export const dynamic = 'force-dynamic';

// Local — Next.js App Router rejects non-route exports from route.ts at
// build time. If another module needs to import this, move it to a
// shared lib file (e.g. lib/refund/window.ts).
const REFUND_WINDOW_DAYS = 14;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason ?? '').trim().slice(0, 500) || null;

  const admin = createServerSupabase();

  // ── Most recent completed purchase for this user ────────
  const { data: purchaseRow, error: purchaseErr } = await admin
    .from('purchases')
    .select('id, created_at, amount_cents, pay_currency, kind, status')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .neq('kind', 'refund')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (purchaseErr) {
    return NextResponse.json({ error: purchaseErr.message }, { status: 500 });
  }
  if (!purchaseRow) {
    return NextResponse.json(
      { error: 'no_eligible_purchase', hint: 'No completed purchase on file.' },
      { status: 404 },
    );
  }

  // ── Eligibility: within window ────────────────────────────
  const purchasedAt = new Date(purchaseRow.created_at as string);
  const ageMs = Date.now() - purchasedAt.getTime();
  const daysSince = Math.floor(ageMs / 86_400_000);
  if (daysSince >= REFUND_WINDOW_DAYS) {
    return NextResponse.json(
      {
        error: 'outside_refund_window',
        days_since_purchase: daysSince,
        window_days: REFUND_WINDOW_DAYS,
      },
      { status: 403 },
    );
  }

  // ── Eligibility: one refund per user lifetime (D8) ────────
  // We count refund_requests in non-rejected statuses. The partial
  // unique index uq_refund_requests_user_lifetime also catches this
  // at the DB layer as a race-safe fallback.
  const { data: priorRefund } = await admin
    .from('refund_requests')
    .select('id, status')
    .eq('user_id', user.id)
    .in('status', ['pending', 'sent', 'confirmed'])
    .limit(1)
    .maybeSingle();
  if (priorRefund) {
    return NextResponse.json(
      {
        error: 'prior_refund_exists',
        existing_status: priorRefund.status,
        hint: 'One refund per user lifetime.',
      },
      { status: 409 },
    );
  }

  // ── Insert the request row ────────────────────────────────
  const usdValue = (purchaseRow.amount_cents as number) ?? 0;
  const { data: inserted, error: insertErr } = await admin
    .from('refund_requests')
    .insert({
      user_id: user.id,
      purchase_id: purchaseRow.id,
      reason,
      refund_amount_usd_cents: usdValue,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    // Possible: race with the partial unique index → 23505. Treat as
    // duplicate (idempotent click).
    const code = (insertErr as { code?: string } | null)?.code;
    if (code === '23505') {
      return NextResponse.json(
        { error: 'duplicate_request' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insertErr?.message ?? 'insert_failed' }, { status: 500 });
  }

  // ── Telemetry ─────────────────────────────────────────────
  void captureServer(user.id, {
    event: 'refund_requested',
    purchase_id: purchaseRow.id as string,
    coin: (purchaseRow.pay_currency as string | null) ?? null,
    usd_value_at_purchase: usdValue,
    days_since_purchase: daysSince,
  });

  return NextResponse.json({
    ok: true,
    refund_request_id: inserted.id,
    eta_business_days: 5,
    days_since_purchase: daysSince,
  });
}
