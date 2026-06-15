import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { blockUser, unblockUser } from '@/lib/comm/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: { target?: unknown };
  try {
    body = (await req.json()) as { target?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const target = typeof body.target === 'string' ? body.target : '';
  if (!UUID_RE.test(target) || target === user.id) return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  const supabase = createServerSupabase();
  await blockUser(supabase, user.id, target);
  return NextResponse.json({ ok: true, blocked: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const target = req.nextUrl.searchParams.get('target') ?? '';
  if (!UUID_RE.test(target)) return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  const supabase = createServerSupabase();
  await unblockUser(supabase, user.id, target);
  return NextResponse.json({ ok: true, blocked: false });
}
