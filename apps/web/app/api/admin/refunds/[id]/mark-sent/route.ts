import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { captureServer } from '@/lib/analytics/server';

// POST /api/admin/refunds/[id]/mark-sent — operator marks a refund as sent.
//
// On state transition (pending → sent):
//   1. UPDATE refund_requests SET status='sent', operator_id, sent_at, refund_tx_hash, operator_note.
//   2. UPDATE purchases SET status='refunded' (the original purchase).
//   3. INSERT a new purchases row { kind: 'refund' } as a marker / audit.
//   4. UPDATE subscriptions SET status='cancelled', cancel_at=NOW().
//   5. UPDATE user_profiles SET tier='citizen' (downgrade).
//   6. INSERT admin_actions row (audit trail).
//   7. Fire PostHog refund_sent event.
//
// State transitions to 'sent' are NOT atomic in a single SQL function
// here (would require another stored proc). Instead we sequence them
// in code with idempotency guards — replaying mark-sent on a row
// already in 'sent' status is a no-op.

interface Body {
  refund_tx_hash?: string;
  operator_note?: string;
}

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!isFounder(user)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const txHash = (body.refund_tx_hash ?? '').trim() || null;
  const operatorNote = (body.operator_note ?? '').trim().slice(0, 500) || null;

  const admin = createServerSupabase();

  // ── Fetch the request (idempotency check) ──────────────────
  const { data: refundRow, error: fetchErr } = await admin
    .from('refund_requests')
    .select('id, user_id, purchase_id, status, refund_amount_usd_cents, requested_at')
    .eq('id', ctx.params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!refundRow) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (refundRow.status === 'sent' || refundRow.status === 'confirmed') {
    return NextResponse.json(
      { ok: true, idempotent: true, status: refundRow.status },
    );
  }
  if (refundRow.status === 'rejected') {
    return NextResponse.json(
      { error: 'already_rejected' },
      { status: 409 },
    );
  }

  // ── 1) Mark the request sent ───────────────────────────────
  const { error: updateRefundErr } = await admin
    .from('refund_requests')
    .update({
      status: 'sent',
      operator_id: user.id,
      operator_note: operatorNote,
      refund_tx_hash: txHash,
      sent_at: new Date().toISOString(),
    })
    .eq('id', refundRow.id);
  if (updateRefundErr) {
    return NextResponse.json({ error: updateRefundErr.message }, { status: 500 });
  }

  // ── 2) Mark the original purchase refunded ──────────────────
  const { data: originalPurchase, error: purchErr } = await admin
    .from('purchases')
    .select('id, user_id, variant_id, amount_cents, currency, pay_currency, created_at, payment_provider')
    .eq('id', refundRow.purchase_id)
    .maybeSingle();
  if (!purchErr && originalPurchase) {
    await admin
      .from('purchases')
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', originalPurchase.id);

    // 3) Insert a "refund" marker purchase. Reuses the purchases table
    // so the user's billing history shows the refund event.
    await admin.from('purchases').insert({
      user_id: originalPurchase.user_id,
      payment_provider: originalPurchase.payment_provider ?? 'nowpayments',
      external_order_id: txHash, // re-use as the on-chain ref
      variant_id: originalPurchase.variant_id,
      kind: 'refund',
      status: 'completed',
      amount_cents: -(originalPurchase.amount_cents ?? 0),
      currency: originalPurchase.currency ?? 'usd',
      pay_currency: 'usdc',
      crypto_tx_hash: txHash,
    });
  }

  // ── 4) Cancel subscription if active ────────────────────────
  await admin
    .from('subscriptions')
    .update({
      status: 'cancelled',
      cancel_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', refundRow.user_id)
    .eq('status', 'active');

  // ── 5) Demote user to citizen ──────────────────────────────
  await admin
    .from('user_profiles')
    .update({ tier: 'citizen', updated_at: new Date().toISOString() })
    .eq('id', refundRow.user_id);

  // ── 6) Audit trail ─────────────────────────────────────────
  // admin_actions CHECK was extended in migration 033 to allow
  // action='refund_sent' and target_table='refund_requests'.
  // override_reason requires >= 12 chars; we synthesize from
  // operator_note if it's too short.
  const reason =
    operatorNote && operatorNote.length >= 12
      ? operatorNote
      : `Refund sent for purchase ${refundRow.purchase_id}`;
  await admin.from('admin_actions').insert({
    actor_user_id: user.id,
    action: 'refund_sent',
    target_table: 'refund_requests',
    target_id: refundRow.id,
    override_reason: reason,
    payload: {
      refund_request_id: refundRow.id,
      purchase_id: refundRow.purchase_id,
      refund_tx_hash: txHash,
      refund_amount_usd_cents: refundRow.refund_amount_usd_cents ?? null,
      user_id: refundRow.user_id,
    },
  });

  // ── 7) Telemetry ───────────────────────────────────────────
  if (originalPurchase) {
    const daysSince = Math.floor(
      (Date.now() - new Date(originalPurchase.created_at as string).getTime()) /
        86_400_000,
    );
    void captureServer(refundRow.user_id, {
      event: 'refund_sent',
      purchase_id: refundRow.purchase_id,
      coin: (originalPurchase.pay_currency as string | null) ?? null,
      usd_value_at_purchase: (originalPurchase.amount_cents as number) ?? 0,
      days_since_purchase: daysSince,
      operator_id: user.id,
    });
  }

  return NextResponse.json({ ok: true, status: 'sent' });
}
