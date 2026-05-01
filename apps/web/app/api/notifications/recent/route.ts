import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';

// GET /api/notifications/recent?hours=24
// Returns the user's fire log for a recent window. Powers the
// "Recent fires" section on /notif?filter=recent (24 h, deep-linked
// from the bell glyph) and PR 12's settings 30-day view.

export const dynamic = 'force-dynamic';

const DEFAULT_HOURS = 24;
const MAX_HOURS = 24 * 30; // 30 days — used by PR 12

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(req.url);
  const requested = Number(url.searchParams.get('hours') ?? DEFAULT_HOURS);
  const hours = Number.isFinite(requested) ? Math.max(1, Math.min(MAX_HOURS, requested)) : DEFAULT_HOURS;

  const supabase = getServerSupabase();
  const since = new Date(Date.now() - hours * 60 * 60_000).toISOString();
  const { data, error } = await supabase
    .from('user_notification_log')
    .select('id, rule_id, fired_at, channel_ids, payload, delivery_status')
    .gte('fired_at', since)
    .order('fired_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ fires: data ?? [], windowHours: hours });
}
