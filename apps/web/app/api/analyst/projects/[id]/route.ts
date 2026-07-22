import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/analyst/access';
import { getProjectOwned, patchProject, archiveProject } from '@/lib/analyst/store';

// /api/analyst/projects/[id] — get / rename+edit-instructions+pin /
// archive. Pro+; ownership enforced on every verb.

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;
  try {
    const project = await getProjectOwned(params.id, caller.userId);
    if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ project });
  } catch (err: any) {
    console.error('[analyst/projects/:id] GET failed:', err?.message);
    return NextResponse.json({ error: 'failed to load project' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    const project = await getProjectOwned(params.id, caller.userId);
    if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await patchProject(project.id, body);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[analyst/projects/:id] PATCH failed:', err?.message);
    return NextResponse.json({ error: 'failed to update project' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;
  try {
    const project = await getProjectOwned(params.id, caller.userId);
    if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await archiveProject(project.id); // soft: sessions keep their history
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[analyst/projects/:id] DELETE failed:', err?.message);
    return NextResponse.json({ error: 'failed to archive project' }, { status: 500 });
  }
}
