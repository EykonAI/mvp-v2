import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { rankByRelevance, type UserQueryRow } from '@/lib/intelligence-analyst/relevance';

// GET /api/user_queries — top-10 history entries by relevance
//
// Fetches up to 50 most-recent rows for the signed-in user, then
// re-ranks by the §3.2 weighted relevance score (recency 0.5 +
// engagement 0.3 + specificity 0.2) with starred=true pinned to top.
// Returns up to 10 entries — the brief's hard cap.
//
// RLS is enforced by the cookie-bound Supabase client (lib/auth/session
// → getServerSupabase). Service-role key is intentionally NOT used here.

const FETCH_WINDOW = 50;
const RETURN_LIMIT = 10;

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('user_queries')
    .select(
      'id, query_text, response_text, tool_calls, domain_tags, created_at, last_run_at, run_count, exported_at, starred',
    )
    .order('last_run_at', { ascending: false })
    .limit(FETCH_WINDOW);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ranked = rankByRelevance((data ?? []) as UserQueryRow[]).slice(0, RETURN_LIMIT);
  return NextResponse.json({ entries: ranked });
}
