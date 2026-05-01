import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { renderQueryPdf, exportFilename } from '@/lib/intelligence-analyst/export-pdf';
import type { ToolCallSummary } from '@/lib/intelligence-analyst/relevance';

export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/export/query/[id] — download a PDF of the query+response.
//
// Per §3.4 of the brief:
//   • header: eYKON wordmark + verbatim query
//   • body: full response (markdown rendered light)
//   • provenance: tool calls, inputs, row counts, fetched-at UTC
//   • footer: page number + generated-at UTC
//
// Ownership is enforced by RLS on the cookie-bound load. After a
// successful render we set user_queries.exported_at = NOW() so the
// relevance ranker can boost exported entries (§3.2 engagement).

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // 1. Load the row under RLS — proves ownership.
  const userSupabase = getServerSupabase();
  const { data: row, error: loadErr } = await userSupabase
    .from('user_queries')
    .select('id, query_text, response_text, tool_calls, last_run_at')
    .eq('id', params.id)
    .single();
  if (loadErr || !row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // 2. Render the PDF.
  const generatedAtIso = new Date().toISOString();
  let pdf: Buffer;
  try {
    pdf = await renderQueryPdf({
      queryText: row.query_text,
      responseText: row.response_text,
      toolCalls: (row.tool_calls ?? []) as ToolCallSummary[],
      fetchedAtIso: row.last_run_at,
      generatedAtIso,
    });
  } catch (err: any) {
    console.error('[export/query] PDF render failed', err?.message);
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 });
  }

  // 3. Mark the row as exported so the relevance ranker picks it up.
  //    Soft-fail — the user already got their PDF; missing the
  //    timestamp is a tracking concern, not a failure mode.
  const admin = createServerSupabase();
  void admin
    .from('user_queries')
    .update({ exported_at: generatedAtIso })
    .eq('id', row.id)
    .eq('user_id', user.id)
    .then(({ error }) => {
      if (error) console.error('[export/query] exported_at write failed', error.message);
    });

  // 4. Stream the PDF as an attachment download.
  const filename = exportFilename(row.query_text, generatedAtIso);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
