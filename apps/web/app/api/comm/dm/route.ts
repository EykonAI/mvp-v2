import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { getOrCreateDm } from '@/lib/comm/dm';

// Start (or reopen) a 1:1 DM with another user. Returns the room id; the
// profile "Message" button navigates to /messages/<room_id>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { to?: unknown };
  try {
    body = (await req.json()) as { to?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const to = typeof body.to === 'string' ? body.to : '';
  if (!UUID_RE.test(to)) return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  if (to === user.id) return NextResponse.json({ error: 'cannot_dm_self' }, { status: 400 });

  const supabase = createServerSupabase();
  const { data: target } = await supabase.from('user_profiles').select('id').eq('id', to).maybeSingle();
  if (!target) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });

  const roomId = await getOrCreateDm(supabase, user.id, to);
  if (!roomId) return NextResponse.json({ error: 'could_not_create' }, { status: 500 });
  return NextResponse.json({ ok: true, room_id: roomId });
}
