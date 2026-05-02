import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { getCurrentTier, tierMeetsRequirement } from '@/lib/subscription';
import {
  HARD_STOP_RATIO,
  SMS_WA_MONTHLY_CAPS,
  SOFT_WARN_RATIO,
  currentPeriodYm,
  getMonthlySmsWaCount,
} from '@/lib/notifications/cap';

// GET /api/notifications/cap-status — current SMS + WhatsApp usage
// vs the user's monthly cap. Powers the "Cap usage" line on the
// /settings ChannelsCard. Cheap query: one COUNT-shaped scan against
// user_notification_log via getMonthlySmsWaCount.

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const tier = await getCurrentTier();
  if (!tierMeetsRequirement(tier, 'pro')) {
    return NextResponse.json({ error: 'forbidden', requiredTier: 'pro' }, { status: 403 });
  }

  const supabase = getServerSupabase();
  const cap = SMS_WA_MONTHLY_CAPS[tier] ?? 0;
  const count = await getMonthlySmsWaCount(supabase, user.id);
  return NextResponse.json(
    {
      period: currentPeriodYm(),
      tier,
      cap,
      count,
      soft_warn_at: Math.round(cap * SOFT_WARN_RATIO),
      hard_stop_at: Math.round(cap * HARD_STOP_RATIO),
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
