import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/analyst/access';
import { getSessionOwned, getMessages, getProjectOwned } from '@/lib/analyst/store';
import { renderSessionPdf, type SessionPdfTurn } from '@/lib/analyst/export-session-pdf';
import { DEFAULT_ANALYST_MODEL, modelLabel } from '@/lib/analyst/model';
import { EXPORT_LIMITS } from '@/lib/intel/modules';

// GET /api/analyst/sessions/[id]/export — full-transcript PDF.
//
// Export is Pro+ leverage (brief §9.4/§9.6). requireSessionAccess('pro')
// gates on effective tier; EXPORT_LIMITS is 0 for citizen/member and
// >0 for pro+, so the tier gate already matches the limit table.
// nodejs runtime for pdfkit.

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;

  // Belt-and-braces against a future tier whose EXPORT_LIMITS is 0.
  if ((EXPORT_LIMITS[caller.tier] ?? 0) <= 0) {
    return NextResponse.json(
      { error: 'Export is available on Pro and above.', required_tier: 'pro', upgrade_url: '/pricing?from=analyst_export' },
      { status: 403 },
    );
  }

  try {
    const session = await getSessionOwned(params.id, caller.userId);
    if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const messages = await getMessages(session.id);
    if (messages.length === 0) {
      return NextResponse.json({ error: 'session is empty' }, { status: 400 });
    }

    let projectName: string | null = null;
    if (session.project_id) {
      const project = await getProjectOwned(session.project_id, caller.userId);
      projectName = project?.name ?? null;
    }

    const turns: SessionPdfTurn[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: (m.tool_calls as SessionPdfTurn['toolCalls']) ?? null,
      createdAtIso: m.created_at,
    }));

    const pdf = await renderSessionPdf({
      title: session.title,
      projectName,
      modelLabel: modelLabel(session.model ?? DEFAULT_ANALYST_MODEL),
      turns,
      generatedAtIso: new Date().toISOString(),
    });

    const slug = session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'session';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `eykon-analyst-${slug}-${date}.pdf`;

    return new NextResponse(pdf as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[analyst/sessions/:id/export] failed:', err?.message);
    return NextResponse.json({ error: 'failed to render PDF' }, { status: 500 });
  }
}
