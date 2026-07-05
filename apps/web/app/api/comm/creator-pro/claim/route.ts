import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { isEligibleCreator, claimFreeSlot } from '@/lib/comm/creatorPro';

// Claim one of the 50 founding Creator Pro slots (free for life).
// Eligibility: owns ≥1 non-archived Space. Race-safety lives in the
// claim_creator_pro_free_slot RPC (advisory lock, mig 074) — this
// route just fronts it.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createServerSupabase();
  if (!(await isEligibleCreator(admin, user.id))) {
    return NextResponse.json(
      { error: 'Creator Pro is for Space creators — open a Space first.' },
      { status: 403 },
    );
  }

  const result = await claimFreeSlot(admin, user.id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
