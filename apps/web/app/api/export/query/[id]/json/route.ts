import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  renderQueryJson,
  exportFilenameForFormat,
} from '@/lib/intelligence-analyst/export-text';
import type { ToolCallSummary } from '@/lib/intelligence-analyst/relevance';

// GET /api/export/query/[id]/json — JSON export (§4.7).

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const userSupabase = getServerSupabase();
  const { data: row, error } = await userSupabase
    .from('user_queries')
    .select('id, query_text, response_text, tool_calls, last_run_at')
    .eq('id', params.id)
    .single();
  if (error || !row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const generatedAtIso = new Date().toISOString();
  const json = renderQueryJson({
    id: row.id,
    queryText: row.query_text,
    responseText: row.response_text,
    toolCalls: (row.tool_calls ?? []) as ToolCallSummary[],
    fetchedAtIso: row.last_run_at,
    generatedAtIso,
  });

  const admin = createServerSupabase();
  void admin
    .from('user_queries')
    .update({ exported_at: generatedAtIso })
    .eq('id', row.id)
    .eq('user_id', user.id)
    .then(({ error: e }) => {
      if (e) console.error('[export/json] exported_at write failed', e.message);
    });

  const filename = exportFilenameForFormat(row.query_text, generatedAtIso, 'json');
  return new NextResponse(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
