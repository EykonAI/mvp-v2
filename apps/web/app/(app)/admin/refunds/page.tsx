import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { RefundsAdminClient, type RefundRow } from './RefundsAdminClient';

// /admin/refunds — founder-only refund reconciliation panel.
//
// Three sections:
//   • Pending — waiting for the operator to send USDC.
//   • Sent — operator has broadcast the tx, awaiting on-chain confirm.
//   • Closed — confirmed or rejected (read-only).
//
// Founder gate: lib/admin/access.ts — FOUNDER_EMAILS env. Without that
// env set, every request redirects to /app (404-style behavior; admin
// existence shouldn't leak).

export const metadata = { title: 'Admin · Refunds — eYKON.ai' };
export const dynamic = 'force-dynamic';

export default async function RefundsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/refunds');
  if (!isFounder(user)) redirect('/app');

  const admin = createServerSupabase();
  const { data: rows } = await admin
    .from('refund_requests')
    .select(
      'id, user_id, purchase_id, reason, status, operator_id, operator_note, refund_tx_hash, refund_amount_usd_cents, requested_at, sent_at, confirmed_at, rejected_at, purchases:purchase_id(amount_cents, pay_currency, variant_id, created_at), user_profiles:user_id(email, display_name)',
    )
    .order('requested_at', { ascending: false })
    .limit(200);

  const refunds: RefundRow[] = ((rows ?? []) as Array<Record<string, unknown>>).map(r => {
    const purchase = (r.purchases ?? {}) as Record<string, unknown>;
    const profile = (r.user_profiles ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id ?? ''),
      user_id: String(r.user_id ?? ''),
      user_email: (profile.email as string | null) ?? null,
      user_display_name: (profile.display_name as string | null) ?? null,
      purchase_id: String(r.purchase_id ?? ''),
      purchase_variant_id: (purchase.variant_id as string | null) ?? null,
      purchase_amount_cents: (purchase.amount_cents as number | null) ?? null,
      purchase_pay_currency: (purchase.pay_currency as string | null) ?? null,
      purchase_created_at: (purchase.created_at as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      status: (r.status as RefundRow['status']) ?? 'pending',
      operator_id: (r.operator_id as string | null) ?? null,
      operator_note: (r.operator_note as string | null) ?? null,
      refund_tx_hash: (r.refund_tx_hash as string | null) ?? null,
      refund_amount_usd_cents: (r.refund_amount_usd_cents as number | null) ?? null,
      requested_at: String(r.requested_at ?? ''),
      sent_at: (r.sent_at as string | null) ?? null,
      confirmed_at: (r.confirmed_at as string | null) ?? null,
      rejected_at: (r.rejected_at as string | null) ?? null,
    };
  });

  return <RefundsAdminClient refunds={refunds} />;
}
