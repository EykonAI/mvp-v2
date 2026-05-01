import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';

// GET /api/notifications/unread-count — last-24-h fire count for the
// authenticated user. Powers the bell-glyph badge in the top-nav.
//
// Live as of PR 6 (cheap cron starts writing user_notification_log).
// Wire shape and Cache-Control headers were stable from PR 2; the
// only swap here is the count source.

export const dynamic = 'force-dynamic';

const WINDOW_HOURS = 24;

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = getServerSupabase();
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60_000).toISOString();
  const { count, error } = await supabase
    .from('user_notification_log')
    .select('id', { count: 'exact', head: true })
    .gte('fired_at', since);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    { count: count ?? 0 },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
