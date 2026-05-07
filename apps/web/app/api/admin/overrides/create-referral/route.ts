import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { isFounder } from '@/lib/admin/access';
import { forceCreateReferral } from '@/lib/admin/overrides';

// POST /api/admin/overrides/create-referral
// Spec §6.10. Founder-only. Force-creates a referrals row from an
// attributed conversion the system missed — the canonical use case
// is the gap between launch and the engine PRs (7-9) shipping:
// referred users converted to paid during that gap, the trigger
// recorded their referred_by but no referrals row was generated.
// This endpoint is the manual backfill path.
//
// Validates: advocate is in 'active' or 'paused' state with a real
// onboarding timestamp, referred user has first_paid_at set, no
// existing referral pair. Computes commission_rate via the same
// annual-cap rule as the auto path will (PR 7) — 50% base, 35%
// above 30 referrals/year.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  advocate_user_id?: string;
  referred_user_id?: string;
  referred_user_email?: string;
  reason?: string;
};

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
  if (typeof body.advocate_user_id !== 'string' || !body.advocate_user_id) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createServerSupabase();

  // Resolve referred user: id wins if both are passed.
  let referredUserId: string | null = null;
  if (typeof body.referred_user_id === 'string' && body.referred_user_id) {
    referredUserId = body.referred_user_id;
  } else if (typeof body.referred_user_email === 'string' && body.referred_user_email) {
    const { data: matched } = await admin
      .from('user_profiles')
      .select('id')
      .eq('email', body.referred_user_email.trim().toLowerCase())
      .maybeSingle();
    referredUserId = (matched as { id: string } | null)?.id ?? null;
    if (!referredUserId) {
      return NextResponse.json({ error: 'referred_not_found' }, { status: 404 });
    }
  } else {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const result = await forceCreateReferral(admin, user.id, {
    advocate_user_id: body.advocate_user_id,
    referred_user_id: referredUserId,
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
  if (code === 'invalid_input' || code === 'self_referral') return 400;
  if (code === 'advocate_not_found' || code === 'referred_not_found') return 404;
  if (
    code === 'advocate_not_eligible' ||
    code === 'advocate_not_onboarded' ||
    code === 'referred_never_paid' ||
    code === 'referral_exists'
  )
    return 409;
  return 500;
}
