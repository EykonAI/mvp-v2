import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';

// GET /api/admin/refunds — list refund requests for the operator panel.
//
// Query params:
//   ?status=pending|sent|confirmed|rejected|all   (default: pending)
//   ?limit=<n>                                    (default: 50, max 200)
//
// Returns rows joined with purchase + user_profile data so the operator
// has everything they need on one screen (wallet address handling lives
// in NOWPayments — we surface enough to reconcile manually).

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!isFounder(user)) {
    // 404-style behaviour — never confirm admin endpoint exists.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status') ?? 'pending';
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') ?? '50'), 1),
    200,
  );

  const admin = createServerSupabase();
  let query = admin
    .from('refund_requests')
    .select(
      'id, user_id, purchase_id, reason, status, operator_id, operator_note, refund_tx_hash, refund_amount_usd_cents, requested_at, sent_at, confirmed_at, rejected_at, purchases:purchase_id(amount_cents, pay_currency, variant_id, created_at), user_profiles:user_id(email, display_name)',
    )
    .order('requested_at', { ascending: false })
    .limit(limit);
  if (statusParam !== 'all') {
    query = query.eq('status', statusParam);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ refunds: data ?? [] });
}
