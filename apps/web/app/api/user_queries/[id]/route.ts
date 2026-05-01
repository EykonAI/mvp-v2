import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';

// PATCH /api/user_queries/[id]
//
// Toggles soft fields on a history entry — currently only `starred`
// (the §4.1 favourite). RLS gates the write (the cookie-bound client
// applies `user_id = auth.uid()`), and the JSON body is whitelisted
// to known mutable fields so a malicious payload cannot, e.g.,
// rewrite query_text or response_text.

const ALLOWED_FIELDS = new Set(['starred']);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no allowed fields in body' }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('user_queries')
    .update(patch)
    .eq('id', params.id)
    .select('id, starred')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json({ entry: data });
}
