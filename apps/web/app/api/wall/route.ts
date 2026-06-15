import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';

// Wall posts for the author's own profile. Owner-only: author_id is
// always the authenticated user (same scoping pattern as
// /api/profile/persona). Light rate-limit by counting the author's
// recent posts (fail-open). DELETE is scoped to author_id so a user can
// only remove their own posts.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 280;
const RATE_WINDOW_S = 60;
const RATE_MAX = 8;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { body?: unknown };
  try {
    body = (await req.json()) as { body?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text || text.length > MAX) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const supabase = createServerSupabase();

  const cutoff = new Date(Date.now() - RATE_WINDOW_S * 1000).toISOString();
  const { count } = await supabase
    .from('comm_wall_posts')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', user.id)
    .gt('created_at', cutoff);
  if ((count ?? 0) >= RATE_MAX) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { data, error } = await supabase
    .from('comm_wall_posts')
    .insert({ author_id: user.id, body: text })
    .select('id, body, created_at')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'insert_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, post: data });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('comm_wall_posts')
    .delete()
    .eq('id', id)
    .eq('author_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
