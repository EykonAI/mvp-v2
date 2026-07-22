import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/analyst/access';
import {
  createInsight,
  listInsights,
  getSessionOwned,
  getProjectOwned,
} from '@/lib/analyst/store';

// /api/analyst/insights — save an answer as an insight; list insights
// (optionally scoped to a project). Insights attach to a project, so
// they are Pro+ leverage (brief §9.5/§9.6).

export async function GET(req: NextRequest) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;
  const projectId = req.nextUrl.searchParams.get('project_id');
  try {
    const insights = await listInsights(caller.userId, projectId);
    return NextResponse.json({ insights });
  } catch (err: any) {
    console.error('[analyst/insights] GET failed:', err?.message);
    return NextResponse.json({ error: 'failed to list insights' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const bodyText = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title || !bodyText) {
    return NextResponse.json({ error: 'title and body required' }, { status: 400 });
  }

  try {
    // Ownership: if a session/project is named, it must be the caller's.
    let sessionId: string | null = null;
    let projectId: string | null = null;
    if (typeof body.session_id === 'string') {
      const session = await getSessionOwned(body.session_id, caller.userId);
      if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
      sessionId = session.id;
      // Default the insight's project to the session's, if any.
      projectId = session.project_id;
    }
    if (typeof body.project_id === 'string') {
      const project = await getProjectOwned(body.project_id, caller.userId);
      if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });
      projectId = project.id;
    }

    const insight = await createInsight({
      userId: caller.userId,
      projectId,
      sessionId,
      messageId: typeof body.message_id === 'string' ? body.message_id : null,
      title: title.slice(0, 160),
      body: bodyText.slice(0, 20000),
      provenance: body.provenance ?? null,
    });
    return NextResponse.json({ insight }, { status: 201 });
  } catch (err: any) {
    console.error('[analyst/insights] POST failed:', err?.message);
    return NextResponse.json({ error: 'failed to save insight' }, { status: 500 });
  }
}
