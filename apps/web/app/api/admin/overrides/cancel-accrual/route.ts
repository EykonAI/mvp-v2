import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { isFounder } from '@/lib/admin/access';
import { forceCancelAccrual } from '@/lib/admin/overrides';

// POST /api/admin/overrides/cancel-accrual
// Spec §6.10. Founder-only. Cancels a 'pending' accrual when a
// refund or chargeback was processed outside the normal flow and
// the row would otherwise sit in pending forever. Released and
// already-forfeited accruals cannot be cancelled this way —
// reversing a released accrual requires a Rewardful adjustment
// (PR 9), not a state flip.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = { accrual_id?: string; reason?: string };

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.accrual_id !== 'string' || !body.accrual_id) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createServerSupabase();
  const result = await forceCancelAccrual(admin, user.id, {
    accrual_id: body.accrual_id,
    reason: body.reason ?? '',
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }
  return NextResponse.json({ ok: true, ...result.data });
}

function errorStatus(code: string): number {
  if (code === 'reason_required' || code === 'reason_too_short' || code === 'reason_too_long') return 400;
  if (code === 'invalid_input') return 400;
  if (code === 'accrual_not_found') return 404;
  if (code === 'invalid_state') return 409;
  return 500;
}
