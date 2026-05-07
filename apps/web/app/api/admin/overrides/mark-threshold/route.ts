import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { isFounder } from '@/lib/admin/access';
import { forceMarkThreshold } from '@/lib/admin/overrides';

// POST /api/admin/overrides/mark-threshold
// Spec §6.10. Founder-only. Force-marks a referral's
// threshold_satisfied flag TRUE — for the case where a referred
// user clearly paid for more than 60 days but the streak counter
// reset due to a billing-system glitch. Subsequent monthly accruals
// will land in 'released' state instead of 'pending'.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = { referral_id?: string; reason?: string };

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
  if (typeof body.referral_id !== 'string' || !body.referral_id) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createServerSupabase();
  const result = await forceMarkThreshold(admin, user.id, {
    referral_id: body.referral_id,
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
  if (code === 'referral_not_found') return 404;
  if (code === 'already_satisfied' || code === 'invalid_status') return 409;
  return 500;
}
