import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess, enforceAiQueryLimit } from '@/lib/analyst/access';
import {
  getSessionOwned,
  getMessages,
  insertMessage,
  touchSession,
  getProjectOwned,
} from '@/lib/analyst/store';
import { runAnalystTurn, type EngineEvent } from '@/lib/analyst/engine';
import { autoTitleSession } from '@/lib/analyst/title';
import { persistUserQuery, type ToolCallRecord } from '@/lib/intelligence-analyst/persistence';
import { safeError } from '@/lib/log';

// POST /api/analyst/sessions/[id]/messages — send a turn.
//
// Default: Server-Sent Events. The client sees text deltas and tool
// lifecycle events as they happen (brief §8.2 — the single largest
// perceived-quality upgrade), then a final `done` event carrying the
// persisted assistant message.
//
// { "stream": false } returns a plain JSON body with the same shape
// as the legacy /api/chat response (content/usage/tool_calls/model)
// plus session fields — the docked panel uses this mode so its
// existing JSON flow keeps working while writing into the session
// store.
//
// Persistence is fail-loud (§ kickoff rules): the user row is
// written BEFORE the model call; if the assistant row cannot be
// written after a completed turn, the client receives an explicit
// error event — never a silent success.

export const maxDuration = 60;

// Context budget when rebuilding history for the model: newest-first
// until ~24k chars / 40 turns. Long-session summarisation is a Full-
// phase feature (brief §8.4); until then the window just slides.
const HISTORY_CHAR_BUDGET = 24_000;
const HISTORY_TURN_BUDGET = 40;

function buildHistory(
  rows: Array<{ role: 'user' | 'assistant'; content: string }>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let chars = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    chars += row.content.length;
    if (out.length >= HISTORY_TURN_BUDGET || chars > HISTORY_CHAR_BUDGET) break;
    out.unshift({ role: row.role, content: row.content });
  }
  return out;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('member');
  if (caller instanceof NextResponse) return caller;
  // Destructured so the nested persistAssistant closure keeps the
  // narrowed types (TS narrowing does not survive into closures).
  const { userId, tier } = caller;

  let body: { content?: unknown; stream?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return NextResponse.json({ error: 'content required' }, { status: 400 });
  }
  const wantStream = body.stream !== false;

  let session;
  try {
    session = await getSessionOwned(params.id, userId);
  } catch (err: any) {
    console.error('[analyst/messages] session load failed:', err?.message);
    return NextResponse.json({ error: 'failed to load session' }, { status: 500 });
  }
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const limited = await enforceAiQueryLimit(userId, caller.tier);
  if (limited) return limited;

  // History + the new user turn. The user row is persisted before the
  // model call so a mid-stream failure can never lose the question.
  let priorRows;
  try {
    priorRows = await getMessages(session.id);
  } catch (err: any) {
    console.error('[analyst/messages] history load failed:', err?.message);
    return NextResponse.json({ error: 'failed to load history' }, { status: 500 });
  }

  const userSeq = (priorRows[priorRows.length - 1]?.seq ?? 0) + 1;
  try {
    await insertMessage({
      sessionId: session.id,
      userId: userId,
      seq: userSeq,
      role: 'user',
      content,
    });
  } catch (err: any) {
    console.error('[analyst/messages] user insert failed:', err?.message);
    return NextResponse.json({ error: 'failed to persist message' }, { status: 500 });
  }

  const history = buildHistory(
    priorRows.map((r) => ({ role: r.role, content: r.content })),
  );
  const engineMessages = [...history, { role: 'user' as const, content }];
  const isFirstExchange = priorRows.length === 0;

  // Project custom instructions (brief §8.4) — a session filed under a
  // project reads as a briefed analyst. Non-fatal on failure.
  let projectInstructions: string | undefined;
  if (session.project_id) {
    try {
      const project = await getProjectOwned(session.project_id, userId);
      projectInstructions = project?.instructions ?? undefined;
    } catch (err: any) {
      console.error('[analyst/messages] project load failed:', err?.message);
    }
  }

  // Shared post-turn persistence: assistant row + session counters +
  // (first exchange only) the Haiku auto-title, awaited so the client
  // can render the new title from the final payload.
  async function persistAssistant(result: {
    text: string;
    toolCalls: unknown[];
    usage: unknown;
    model: string;
  }) {
    const assistantRow = await insertMessage({
      sessionId: session!.id,
      userId: userId,
      seq: userSeq + 1,
      role: 'assistant',
      content: result.text,
      toolCalls: result.toolCalls,
      provenance: {
        tools: result.toolCalls,
        fetched_at: new Date().toISOString(),
        model: result.model,
      },
      tokenUsage: result.usage,
    });
    await touchSession({ sessionId: session!.id, messageCount: userSeq + 1 });

    // Continuity write (brief §7.1): user_queries stays the backing
    // store for the docked panel's Query History tab, the Suggested
    // ranker and the per-query PDF export/share flow until the
    // workspace fully supersedes them — so every session turn also
    // lands one user_queries row. Non-fatal on failure.
    let queryId: string | null = null;
    try {
      queryId = await persistUserQuery({
        userId: userId,
        queryText: content,
        responseText: result.text,
        toolCalls: result.toolCalls as ToolCallRecord[],
      });
    } catch (err: any) {
      console.error('[analyst/messages] persistUserQuery threw:', err?.message);
    }

    let title: string | null = null;
    if (isFirstExchange) {
      await autoTitleSession({
        sessionId: session!.id,
        userText: content,
        assistantText: result.text,
      });
      const refreshed = await getSessionOwned(session!.id, userId);
      title = refreshed?.title ?? null;
    }
    return { assistantRow, title, queryId };
  }

  if (!wantStream) {
    // JSON mode — same contract as legacy /api/chat plus session ids.
    try {
      const result = await runAnalystTurn({
        messages: engineMessages,
        tier: tier,
        persona: session.persona ?? undefined,
        model: session.model ?? undefined,
        projectInstructions,
      });
      const { assistantRow, title, queryId } = await persistAssistant(result);
      return NextResponse.json({
        content: result.text,
        usage: result.usage,
        tool_calls: result.iterations,
        model: result.model,
        session_id: session.id,
        message_id: assistantRow.id,
        query_id: queryId,
        title,
      });
    } catch (err: any) {
      safeError('[analyst/messages] turn failed:', err);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // SSE mode.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        const result = await runAnalystTurn({
          messages: engineMessages,
          tier: tier,
          persona: session!.persona ?? undefined,
          model: session!.model ?? undefined,
          projectInstructions,
          onEvent: (ev: EngineEvent) => send(ev as unknown as Record<string, unknown>),
        });
        try {
          const { assistantRow, title, queryId } = await persistAssistant(result);
          send({
            type: 'done',
            content: result.text,
            usage: result.usage,
            tool_calls: result.iterations,
            model: result.model,
            session_id: session!.id,
            message_id: assistantRow.id,
            query_id: queryId,
            title,
          });
        } catch (persistErr: any) {
          // Fail loud: the answer streamed but was NOT saved.
          console.error('[analyst/messages] assistant persist failed:', persistErr?.message);
          send({
            type: 'error',
            error: 'Answer generated but could not be saved — it will not appear in history.',
          });
        }
      } catch (err: any) {
        safeError('[analyst/messages] stream turn failed:', err);
        send({ type: 'error', error: err?.message ?? 'analyst turn failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
