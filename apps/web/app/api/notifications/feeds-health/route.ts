import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { getFeedHealth } from '@/lib/notifications/feed-health';

// /api/notifications/feeds-health — read-only diagnostic endpoint.
//
// Returns, per DataBucket, whether the underlying ingest table has
// rows, when it was last written, and a coarse freshness label
// (live / stale / empty). The /notif page uses the same probe
// server-side to filter the suggestion library; this endpoint exposes
// it for debugging and a future admin dashboard.
//
// Auth: any authenticated user. The data isn't sensitive — it's just
// "is this feed live right now" — but unauthenticated callers don't
// need to pulse our DB.

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = getServerSupabase();
  const health = await getFeedHealth(supabase);
  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    feeds: health,
  });
}
