import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getCurrentTier, type Tier } from '@/lib/subscription';
import { safeError } from '@/lib/log';
import { persistUserQuery } from '@/lib/intelligence-analyst/persistence';
import { runAnalystTurn } from '@/lib/analyst/engine';
import { enforceAiQueryLimit } from '@/lib/analyst/access';

// Legacy stateless analyst endpoint. Kept as the Citizen path (no
// persisted sessions per the §9.6 gating decision) and as the
// fallback for panel clients that predate AI ANALYST v2. Member+
// docked traffic now flows through /api/analyst/sessions/*, which
// persists turns; both paths share the ONE engine + model config
// (lib/analyst/engine.ts, lib/analyst/model.ts).

export const maxDuration = 60;

async function resolveCaller(): Promise<{ userId: string | null; tier: Tier }> {
  const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true';
  if (!authEnabled) {
    return { userId: null, tier: 'pro' };
  }
  const user = await getCurrentUser();
  if (!user) return { userId: null, tier: 'citizen' };
  const tier = await getCurrentTier();
  return { userId: user.id, tier };
}

/**
 * Extract the freshest user-typed message from the request payload.
 * Walks back-to-front looking for a `role === 'user'` message whose
 * content is a string — internal tool-result rounds carry array
 * content and are not the user's prompt.
 */
function extractLastUserText(messages: Array<{ role: string; content: any }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      return m.content;
    }
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    const { messages, persona } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 });
    }

    // ── Tier gate + atomic rate limit ────────────────────────
    const { userId, tier } = await resolveCaller();

    if (process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true' && !userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (userId) {
      const limited = await enforceAiQueryLimit(userId, tier);
      if (limited) return limited;
    }

    const apiMessages = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: m.content }));

    const result = await runAnalystTurn({
      messages: apiMessages,
      tier,
      persona,
    });

    // Persist for the Query History tab and the Suggested-tab ranker.
    // Citizen tier skips persistence per the trial-mechanism brief §5.1.
    let queryId: string | null = null;
    if (userId && tier !== 'citizen') {
      const userQueryText = extractLastUserText(apiMessages);
      if (userQueryText) {
        try {
          queryId = await persistUserQuery({
            userId,
            queryText: userQueryText,
            responseText: result.text,
            toolCalls: result.toolCalls,
          });
        } catch (err: any) {
          console.error('[chat] persistUserQuery threw:', err?.message);
        }
      }
    }

    return NextResponse.json({
      content: result.text,
      usage: result.usage,
      tool_calls: result.iterations,
      model: result.model,
      query_id: queryId,
    });
  } catch (err: any) {
    safeError('Chat API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
