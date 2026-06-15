import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { getCurrentTier, type Tier } from '@/lib/subscription';
import { isMember } from '@/lib/comm/dm';
import { getAnalystId } from '@/lib/comm/analyst';
import { runAnalyst } from '@/lib/intelligence-analyst/run';

// COMM D3 — invoke the AI Analyst inside a room. Posts the asker's question
// (as them) then the analyst's reply (as the reserved analyst profile), so
// the whole room sees both. Gated by COMM_ANALYST_PROFILE_ID; membership-
// checked; rate-limited per room (analyst calls are expensive).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_Q = 1000;
const MAX_A = 4000; // comm_messages.body CHECK upper bound
const RATE_WINDOW_S = 60;
const RATE_MAX = 3; // analyst replies per room per window

export async function POST(req: NextRequest) {
  const analystId = getAnalystId();
  if (!analystId) return NextResponse.json({ error: 'analyst_not_configured' }, { status: 503 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let payload: { room?: unknown; question?: unknown };
  try {
    payload = (await req.json()) as { room?: unknown; question?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const room = typeof payload.room === 'string' ? payload.room : '';
  const question = typeof payload.question === 'string' ? payload.question.trim() : '';
  if (!room || !question || question.length > MAX_Q) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const supabase = createServerSupabase();
  if (!(await isMember(supabase, room, user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Rate-limit analyst replies per room (bounds token spend).
  const cutoff = new Date(Date.now() - RATE_WINDOW_S * 1000).toISOString();
  const { count } = await supabase
    .from('comm_messages')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', room)
    .eq('author_id', analystId)
    .gt('created_at', cutoff);
  if ((count ?? 0) >= RATE_MAX) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  // Post the asker's question so the room sees what was asked.
  await supabase.from('comm_messages').insert({ room_id: room, author_id: user.id, body: question });

  // Tier-gated tool surface, mirroring /api/chat.
  let tier: Tier = 'pro';
  try {
    tier = await getCurrentTier();
  } catch {
    /* default to pro on resolution failure */
  }

  let answer = '';
  try {
    const result = await runAnalyst({ prompt: question, tier });
    answer = result.text.trim();
  } catch {
    answer = '';
  }
  if (!answer) answer = 'I could not produce an answer for that just now — try rephrasing.';
  if (answer.length > MAX_A) answer = `${answer.slice(0, MAX_A - 1)}…`;

  const { data, error } = await supabase
    .from('comm_messages')
    .insert({ room_id: room, author_id: analystId, body: answer })
    .select('id, author_id, body, created_at')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'insert_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: data });
}
