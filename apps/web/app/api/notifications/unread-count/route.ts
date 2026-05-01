import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';

// GET /api/notifications/unread-count — last-24-h fire count for the
// authenticated user. Powers the bell-glyph badge in the top-nav.
//
// Stubbed to 0 in PR 2 (top-nav rebalance). PR 6 swaps the body for
// the real query against user_notification_log once the cron evaluator
// starts writing rows, so the wire shape and headers are stable from
// day one — no callsite churn when the count goes live.

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  return NextResponse.json(
    { count: 0 },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
