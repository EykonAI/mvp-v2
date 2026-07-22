import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/analyst/access';
import { listProjects, createProject } from '@/lib/analyst/store';

// /api/analyst/projects — list + create. Projects are Pro+ leverage
// (brief §9.6); requireSessionAccess('pro') enforces effective tier.

export async function GET() {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;
  try {
    const projects = await listProjects(caller.userId);
    return NextResponse.json({ projects });
  } catch (err: any) {
    console.error('[analyst/projects] GET failed:', err?.message);
    return NextResponse.json({ error: 'failed to list projects' }, { status: 500 });
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
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  try {
    const project = await createProject({
      userId: caller.userId,
      name: name.slice(0, 120),
      description: typeof body.description === 'string' ? body.description.slice(0, 2000) : null,
      instructions: typeof body.instructions === 'string' ? body.instructions.slice(0, 8000) : null,
      color: typeof body.color === 'string' ? body.color.slice(0, 32) : null,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (err: any) {
    console.error('[analyst/projects] POST failed:', err?.message);
    return NextResponse.json({ error: 'failed to create project' }, { status: 500 });
  }
}
