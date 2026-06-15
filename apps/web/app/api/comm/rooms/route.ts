import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { listRooms, createRoom } from '@/lib/comm/rooms';

// List group rooms (GET) and create one (POST). Auth required.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const supabase = createServerSupabase();
  return NextResponse.json({ rooms: await listRooms(supabase, user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { title?: unknown };
  try {
    body = (await req.json()) as { title?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 80) return NextResponse.json({ error: 'invalid_title' }, { status: 400 });

  const supabase = createServerSupabase();
  const roomId = await createRoom(supabase, user.id, title);
  if (!roomId) return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  return NextResponse.json({ ok: true, room_id: roomId });
}
