import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';

// POST /api/notifications/mark-seen
// Sets user_profiles.last_notifications_seen_at = NOW() for the
// authenticated caller. Powers the bell-badge clear-on-click flow
// (PR-NF-bell-clear). Idempotent — repeated calls just advance the
// timestamp; the bell badge will then read zero until a NEW fire
// lands after this moment.
//
// Auth: getCurrentUser. RLS on user_profiles enforces the row-level
// scoping (self-manage policy from migration 001), but we additionally
// .eq('id', user.id) to make the intent explicit.

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = getServerSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_profiles')
    .update({ last_notifications_seen_at: now })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, seen_at: now });
}
