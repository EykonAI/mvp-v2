import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';

// GET /api/notifications/unread-count — bell-badge count.
//
// Semantics:
//   count = fires with fired_at > MAX(last_notifications_seen_at,
//                                     now - 24 h).
//
// • A user who clicks the bell sets last_notifications_seen_at = NOW()
//   via POST /api/notifications/mark-seen (migration 030). The next
//   poll then reads zero until a new fire lands.
// • A user who has never clicked the bell (NULL seen_at) gets the
//   legacy "last 24 h" behaviour — no regression on pre-existing rows.
// • A user who clicked > 24 h ago is still capped at the 24-h window
//   so the badge doesn't surface a multi-week backlog as one number.

export const dynamic = 'force-dynamic';

const WINDOW_HOURS = 24;

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = getServerSupabase();

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('last_notifications_seen_at')
    .eq('id', user.id)
    .maybeSingle();

  const cutoff24h = Date.now() - WINDOW_HOURS * 60 * 60_000;
  const seenAtMs = profile?.last_notifications_seen_at
    ? new Date(profile.last_notifications_seen_at).getTime()
    : 0;
  const sinceMs = Math.max(cutoff24h, Number.isFinite(seenAtMs) ? seenAtMs : 0);
  const since = new Date(sinceMs).toISOString();

  const { count, error } = await supabase
    .from('user_notification_log')
    .select('id', { count: 'exact', head: true })
    .gt('fired_at', since);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    { count: count ?? 0 },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
