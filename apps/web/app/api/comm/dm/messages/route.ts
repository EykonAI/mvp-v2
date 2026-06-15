import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { isMember, loadMessages, markRead } from '@/lib/comm/dm';

// List / send messages in a DM room. Membership is enforced on every
// call; GET also marks the room read. Polled by the Thread client.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 4000;
const RATE_WINDOW_S = 60;
const RATE_MAX = 30;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const room = req.nextUrl.searchParams.get('room') ?? '';
  const after = req.nextUrl.searchParams.get('after') ?? undefined;
  if (!room) return NextResponse.json({ error: 'missing_room' }, { status: 400 });

  const supabase = createServerSupabase();
  if (!(await isMember(supabase, room, user.id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const messages = await loadMessages(supabase, room, after);
  await markRead(supabase, room, user.id);
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { room?: unknown; body?: unknown };
  try {
    body = (await req.json()) as { room?: unknown; body?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const room = typeof body.room === 'string' ? body.room : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!room || !text || text.length > MAX) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const supabase = createServerSupabase();
  if (!(await isMember(supabase, room, user.id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const cutoff = new Date(Date.now() - RATE_WINDOW_S * 1000).toISOString();
  const { count } = await supabase
    .from('comm_messages')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', user.id)
    .gt('created_at', cutoff);
  if ((count ?? 0) >= RATE_MAX) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { data, error } = await supabase
    .from('comm_messages')
    .insert({ room_id: room, author_id: user.id, body: text })
    .select('id, author_id, body, created_at')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'insert_failed' }, { status: 500 });
  return NextResponse.json({ ok: true, message: data });
}
