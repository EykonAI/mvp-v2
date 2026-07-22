import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess, tierAtLeast } from '@/lib/analyst/access';
import {
  getSessionOwned,
  getMessages,
  patchSession,
  deleteSession,
  setSessionModel,
  setSessionProject,
  getProjectOwned,
} from '@/lib/analyst/store';
import { allowedSessionModels, DEEP_ANALYSIS_MODEL } from '@/lib/analyst/model';

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

    // Model (Deep Analysis toggle) — entitlement-bearing, validated
    // here, never via the generic whitelist. null clears to the engine
    // default; the Opus deep model requires Pro+ (§9.6).
    if ('model' in body) {
      const m = body.model;
      if (m === null) {
        await setSessionModel(session.id, null);
      } else if (typeof m === 'string' && allowedSessionModels().includes(m)) {
        if (m === DEEP_ANALYSIS_MODEL && !tierAtLeast(caller.tier, 'pro')) {
          return NextResponse.json(
            { error: 'Deep Analysis is available on Pro and above.', required_tier: 'pro', upgrade_url: '/pricing?from=analyst_deep' },
            { status: 403 },
          );
        }
        await setSessionModel(session.id, m);
      } else {
        return NextResponse.json({ error: 'unknown model' }, { status: 400 });
      }
    }

    // Project assignment — projects are Pro+ (§9.6); null unfiles.
    if ('project_id' in body) {
      const pid = body.project_id;
      if (!tierAtLeast(caller.tier, 'pro')) {
        return NextResponse.json(
          { error: 'Projects are available on Pro and above.', required_tier: 'pro', upgrade_url: '/pricing?from=analyst_pro' },
          { status: 403 },
        );
      }
      if (pid === null) {
        await setSessionProject(session.id, null);
      } else if (typeof pid === 'string') {
        const project = await getProjectOwned(pid, caller.userId);
        if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });
        await setSessionProject(session.id, project.id);
      } else {
        return NextResponse.json({ error: 'invalid project_id' }, { status: 400 });
      }
    }

    // title / pinned / persona via the generic whitelist.
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
