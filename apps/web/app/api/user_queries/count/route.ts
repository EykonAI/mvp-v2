import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';

// GET /api/user_queries/count — exact count of the user's history.
//
// The list endpoint caps at 10 by design (the Query History tab
// only ever shows top-10), so the settings page can't rely on it
// for an accurate "N entries on record" disclosure. RLS-enforced.

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = getServerSupabase();
  const { count, error } = await supabase
    .from('user_queries')
    .select('id', { count: 'exact', head: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ count: count ?? 0 });
}
