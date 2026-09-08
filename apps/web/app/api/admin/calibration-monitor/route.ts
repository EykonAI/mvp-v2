import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { loadMonitor, parseFilters } from '@/lib/admin/calibration-monitor';

// /api/admin/calibration-monitor — founder-gated (build-prompt v1.1, §7).
//
// GET  ?period=7|30|90|all|custom&from=&to=&basis=resolved|issued&track=&family=
//      One JSON with generated_at, the parsed filters, and every panel's data;
//      each probe carries its own as_of and error — a failed RPC never fails
//      the response.
// POST { action: 'watch.add', text, due_at? } | { action: 'watch.seen', id } |
//      { action: 'watch.unseen', id } | { action: 'watch.delete', id }
//      The ONLY writes this module makes (§10): watch-list entries. No
//      resolution, no void, no register write happens from here.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const monitor = await loadMonitor(parseFilters(req.nextUrl.searchParams));
  return NextResponse.json(monitor, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  let body: { action?: string; text?: string; due_at?: string | null; id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const supabase = createServerSupabase();
  const id = Number(body.id);
  switch (body.action) {
    case 'watch.add': {
      const text = (body.text ?? '').trim().slice(0, 500);
      if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });
      const due = body.due_at && !Number.isNaN(Date.parse(body.due_at)) ? new Date(body.due_at).toISOString() : null;
      const { error } = await supabase.from('ledger_watch_items').insert({ text, due_at: due });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    case 'watch.seen':
    case 'watch.unseen': {
      if (!Number.isInteger(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { error } = await supabase
        .from('ledger_watch_items')
        .update({ seen_at: body.action === 'watch.seen' ? new Date().toISOString() : null })
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    case 'watch.delete': {
      if (!Number.isInteger(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { error } = await supabase.from('ledger_watch_items').delete().eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}
