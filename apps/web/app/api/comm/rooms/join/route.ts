import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { joinRoom } from '@/lib/comm/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { room?: unknown };
  try {
    body = (await req.json()) as { room?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const room = typeof body.room === 'string' ? body.room : '';
  if (!room) return NextResponse.json({ error: 'invalid_room' }, { status: 400 });

  const supabase = createServerSupabase();
  const ok = await joinRoom(supabase, user.id, room);
  if (!ok) return NextResponse.json({ error: 'room_not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
