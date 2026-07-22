import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/analyst/access';
import {
  getSessionOwned,
  getMessages,
  patchSession,
  deleteSession,
} from '@/lib/analyst/store';

// /api/analyst/sessions/[id] — load (with full thread), rename/pin,
// delete. Ownership is enforced on EVERY verb via getSessionOwned;
// a session that isn't the caller's returns 404 (not 403 — no
// existence oracle).

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('member');
  if (caller instanceof NextResponse) return caller;
  try {
    const session = await getSessionOwned(params.id, caller.userId);
    if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const messages = await getMessages(session.id);
    return NextResponse.json({ session, messages });
  } catch (err: any) {
    console.error('[analyst/sessions/:id] GET failed:', err?.message);
    return NextResponse.json({ error: 'failed to load session' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('member');
  if (caller instanceof NextResponse) return caller;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    const session = await getSessionOwned(params.id, caller.userId);
    if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await patchSession(session.id, body);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[analyst/sessions/:id] PATCH failed:', err?.message);
    return NextResponse.json({ error: 'failed to update session' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('member');
  if (caller instanceof NextResponse) return caller;
  try {
    const session = await getSessionOwned(params.id, caller.userId);
    if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await deleteSession(session.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[analyst/sessions/:id] DELETE failed:', err?.message);
    return NextResponse.json({ error: 'failed to delete session' }, { status: 500 });
  }
}
