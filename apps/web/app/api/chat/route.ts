import { NextRequest, NextResponse } from 'next/server';
import { getAnthropic, CLAUDE_TOOLS, CONVERSATIONAL_SYSTEM_PROMPT } from '@/lib/anthropic';
import { executeToolCall } from '@/lib/tool-executor';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  AI_QUERY_LIMITS,
  getCurrentTier,
  tierMeetsRequirement,
  type Tier,
} from '@/lib/subscription';
import { captureServer } from '@/lib/analytics/server';
import {
  persistUserQuery,
  rowCountFromToolResult,
  type ToolCallRecord,
} from '@/lib/intelligence-analyst/persistence';

export const maxDuration = 60;

/**
 * Returns a (userId, tier) pair for rate limiting. Honours the
 * NEXT_PUBLIC_AUTH_ENABLED feature flag: when auth is disabled (pre-Phase-2
 * activation), we short-circuit with a synthetic 'pro' tier and no user id,
 * which causes the RPC path below to be skipped entirely. Once the flag is
 * on, middleware guarantees a session on every (app)/* route, and we resolve
 * the real user + tier.
 */
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
    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 });
    }

    // ── Tier gate + atomic rate limit ────────────────────────
    const { userId, tier } = await resolveCaller();

    // Unauthenticated (auth on, no session): middleware should already have
    // redirected, but belt-and-braces.
    if (process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true' && !userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Citizen and below have no AI quota.
    if (!tierMeetsRequirement(tier, 'pro')) {
      return NextResponse.json(
        {
          error: 'AI analyst is a Pro feature.',
          upgrade_url: '/pricing',
          current_tier: tier,
        },
        { status: 403 },
      );
    }

    // Atomic per-user monthly cap. The RPC returns allowed=false when the
    // user has already hit the limit for the current calendar month.
    if (userId) {
      const limit = AI_QUERY_LIMITS[tier];
      const admin = createServerSupabase();
      const { data, error } = await admin.rpc('increment_usage_counter', {
        p_user_id: userId,
        p_counter: 'ai_queries',
        p_limit: limit,
      });
      if (error) {
        console.error('[chat] increment_usage_counter failed', error.message);
        return NextResponse.json({ error: 'rate-limit check failed' }, { status: 500 });
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.allowed) {
        return NextResponse.json(
          {
            error: `Monthly AI analyst limit reached (${limit} queries).`,
            used: row?.new_value ?? limit,
            limit,
            period_start: row?.period_start,
            tier,
            upgrade_url: tier === 'pro' ? '/pricing?plan=desk_founding_annual' : undefined,
          },
          { status: 429 },
        );
      }
      // Fire ai_query only after the increment succeeds so PostHog counters
      // match usage_counters exactly. Fire-and-forget so the chat hot path
      // doesn't wait on PostHog's HTTP round-trip.
      void captureServer(userId, {
        event: 'ai_query',
        tier,
        queries_this_month: row?.new_value ?? undefined,
      });
    }

    const anthropic = getAnthropic();

    const apiMessages = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => ({ role: m.role, content: m.content }));

    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: CONVERSATIONAL_SYSTEM_PROMPT,
      tools: CLAUDE_TOOLS,
      messages: apiMessages,
    });

    const allMessages = [...apiMessages];
    // Captured for the user_queries write below — one record per
    // tool_use block across all loop iterations.
    const capturedToolCalls: ToolCallRecord[] = [];
    let iterations = 0;
    const maxIterations = 5;

    while (response.stop_reason === 'tool_use' && iterations < maxIterations) {
      iterations++;

      const toolUseBlocks = response.content.filter((b): b is { type: 'tool_use'; id: string; name: string; input: unknown } => b.type === 'tool_use');

      allMessages.push({ role: 'assistant', content: response.content });

      const toolResults: any[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeToolCall(toolUse.name, toolUse.input as Record<string, any>);
        capturedToolCalls.push({
          name: toolUse.name,
          input: (toolUse.input ?? {}) as Record<string, any>,
          row_count: rowCountFromToolResult(result),
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      allMessages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        system: CONVERSATIONAL_SYSTEM_PROMPT,
        tools: CLAUDE_TOOLS,
        messages: allMessages,
      });
    }

    const textContent = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    // Persist for the Query History tab and the Suggested-tab ranker.
    // Awaited so the row exists before the client re-fetches history;
    // failures are logged inside persistUserQuery and never thrown.
    let queryId: string | null = null;
    if (userId) {
      const userQueryText = extractLastUserText(apiMessages);
      if (userQueryText) {
        try {
          queryId = await persistUserQuery({
            userId,
            queryText: userQueryText,
            responseText: textContent,
            toolCalls: capturedToolCalls,
          });
        } catch (err: any) {
          console.error('[chat] persistUserQuery threw:', err?.message);
        }
      }
    }

    return NextResponse.json({
      content: textContent,
      usage: response.usage,
      tool_calls: iterations,
      model: response.model,
      query_id: queryId,
    });
  } catch (err: any) {
    console.error('Chat API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
