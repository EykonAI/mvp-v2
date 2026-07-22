import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/analyst/access';
import {
  getProjectOwned,
  listInsights,
  listSessionsByProject,
  getMessages,
} from '@/lib/analyst/store';
import {
  renderProjectDossierPdf,
  type DossierSession,
  type SessionPdfTurn,
} from '@/lib/analyst/export-session-pdf';
import { DEFAULT_ANALYST_MODEL, modelLabel } from '@/lib/analyst/model';
import { EXPORT_LIMITS } from '@/lib/intel/modules';

// GET /api/analyst/projects/[id]/export — the project dossier: saved
// insights + every session transcript in one client-ready PDF (brief
// §9.4, the premium deliverable). Pro+ leverage; nodejs for pdfkit.

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;

  if ((EXPORT_LIMITS[caller.tier] ?? 0) <= 0) {
    return NextResponse.json(
      { error: 'Export is available on Pro and above.', required_tier: 'pro', upgrade_url: '/pricing?from=analyst_export' },
      { status: 403 },
    );
  }

  try {
    const project = await getProjectOwned(params.id, caller.userId);
    if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const [insightRows, sessionRows] = await Promise.all([
      listInsights(caller.userId, project.id),
      listSessionsByProject(caller.userId, project.id),
    ]);

    if (insightRows.length === 0 && sessionRows.length === 0) {
      return NextResponse.json({ error: 'project has no sessions or insights to compile' }, { status: 400 });
    }

    // Pull each session's transcript. Sequential to keep memory flat;
    // a dossier is not a hot path.
    const sessions: DossierSession[] = [];
    for (const s of sessionRows) {
      const messages = await getMessages(s.id);
      if (messages.length === 0) continue;
      sessions.push({
        title: s.title,
        turns: messages.map<SessionPdfTurn>((m) => ({
          role: m.role,
          content: m.content,
          toolCalls: (m.tool_calls as SessionPdfTurn['toolCalls']) ?? null,
          createdAtIso: m.created_at,
        })),
      });
    }

    const pdf = await renderProjectDossierPdf({
      projectName: project.name,
      description: project.description,
      instructions: project.instructions,
      insights: insightRows.map((i) => ({ title: i.title, body: i.body, createdAtIso: i.created_at })),
      sessions,
      modelLabel: modelLabel(DEFAULT_ANALYST_MODEL),
      generatedAtIso: new Date().toISOString(),
    });

    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `eykon-dossier-${slug}-${date}.pdf`;

    return new NextResponse(pdf as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[analyst/projects/:id/export] failed:', err?.message);
    return NextResponse.json({ error: 'failed to render dossier' }, { status: 500 });
  }
}
