import { NextRequest, NextResponse } from 'next/server';
import {
  getAnthropic,
  CLAUDE_TOOLS,
  CONVERSATIONAL_SYSTEM_PROMPT,
} from '@/lib/anthropic';
import { executeToolCall } from '@/lib/tool-executor';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  AI_QUERY_LIMITS,
  getCurrentTier,
  tierMeetsRequirement,
} from '@/lib/subscription';
import { captureServer } from '@/lib/analytics/server';
import {
  inferDomainTags,
  rowCountFromToolResult,
  type ToolCallRecord,
} from '@/lib/intelligence-analyst/persistence';
import { decorateSystemPrompt, isValidPersona } from '@/lib/intelligence-analyst/personas';

export const maxDuration = 60;

// POST /api/user_queries/[id]/rerun
//
// Fetches a stored history entry, re-executes its query against
// fresh data, and updates the existing row in place — bumping
// run_count + last_run_at via the atomic RPC from migration 022.
//
// Tier gate + rate-limit mirror /api/chat. Ownership is enforced
// twice: once via RLS on the cookie-bound load, once via the
// p_user_id parameter when invoking the increment RPC.

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    // Persona is optional — POST body may carry { persona: 'analyst' }.
    let personaInput: unknown;
    try {
      personaInput = (await req.json())?.persona;
    } catch { /* no body / not JSON — ignore */ }
    const persona = isValidPersona(personaInput) ? personaInput : undefined;
    const systemPrompt = decorateSystemPrompt(CONVERSATIONAL_SYSTEM_PROMPT, persona);

    const tier = await getCurrentTier();
    if (!tierMeetsRequirement(tier, 'pro')) {
      return NextResponse.json(
        { error: 'AI analyst is a Pro feature.', upgrade_url: '/pricing', current_tier: tier },
        { status: 403 },
      );
    }

    // ── 1. Load the row under RLS (proves ownership) ──────────
    const userSupabase = getServerSupabase();
    const { data: row, error: loadErr } = await userSupabase
      .from('user_queries')
      .select('id, query_text')
      .eq('id', params.id)
      .single();
    if (loadErr || !row) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // ── 2. Per-user monthly cap (same path as /api/chat) ──────
    const limit = AI_QUERY_LIMITS[tier];
    const admin = createServerSupabase();
    const { data: rateData, error: rateErr } = await admin.rpc('increment_usage_counter', {
      p_user_id: user.id,
      p_counter: 'ai_queries',
      p_limit: limit,
    });
    if (rateErr) {
      console.error('[rerun] increment_usage_counter failed', rateErr.message);
      return NextResponse.json({ error: 'rate-limit check failed' }, { status: 500 });
    }
    const rate = Array.isArray(rateData) ? rateData[0] : rateData;
    if (!rate?.allowed) {
      return NextResponse.json(
        {
          error: `Monthly AI analyst limit reached (${limit} queries).`,
          used: rate?.new_value ?? limit,
          limit,
          tier,
        },
        { status: 429 },
      );
    }
    void captureServer(user.id, {
      event: 'ai_query',
      tier,
      queries_this_month: rate?.new_value ?? undefined,
      source: 'rerun',
    });

    // ── 3. Fresh single-turn conversation ─────────────────────
    // Re-runs are NOT threaded: the user wants fresh data for the
    // same question, not a continuation of the original chat.
    const anthropic = getAnthropic();
    const seedMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [
      { role: 'user', content: row.query_text },
    ];
    const allMessages = [...seedMessages];
    const capturedToolCalls: ToolCallRecord[] = [];
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      tools: CLAUDE_TOOLS,
      messages: seedMessages,
    });
    let iterations = 0;
    const maxIterations = 5;
    while (response.stop_reason === 'tool_use' && iterations < maxIterations) {
      iterations++;
      const toolUseBlocks = response.content.filter(
        (b): b is { type: 'tool_use'; id: string; name: string; input: unknown } =>
          b.type === 'tool_use',
      );
      allMessages.push({ role: 'assistant', content: response.content });
      const toolResults: any[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeToolCall(toolUse.name, toolUse.input as Record<string, any>);
        capturedToolCalls.push({
          name: toolUse.name,
          input: (toolUse.input ?? {}) as Record<string, any>,
          row_count: rowCountFromToolResult(result),
        });
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
      }
      allMessages.push({ role: 'user', content: toolResults });
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        system: systemPrompt,
        tools: CLAUDE_TOOLS,
        messages: allMessages,
      });
    }
    const textContent = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    // ── 4. Persist fresh response + tags + atomic counter bump ─
    const newTags = inferDomainTags(row.query_text, capturedToolCalls);
    const { error: updateErr } = await admin
      .from('user_queries')
      .update({
        response_text: textContent,
        tool_calls: capturedToolCalls,
        domain_tags: newTags,
      })
      .eq('id', row.id)
      .eq('user_id', user.id);
    if (updateErr) {
      console.error('[rerun] update failed', updateErr.message);
      // Soft-fail: still return the fresh response to the user.
    }
    // run_count + last_run_at are bumped atomically by the RPC so
    // concurrent re-runs don't race and lose increments.
    const { error: rpcErr } = await admin.rpc('increment_user_query_run_count', {
      p_id: row.id,
      p_user_id: user.id,
    });
    if (rpcErr) {
      console.error('[rerun] increment_user_query_run_count failed', rpcErr.message);
    }

    return NextResponse.json({
      content: textContent,
      usage: response.usage,
      tool_calls: iterations,
      model: response.model,
      query_id: row.id,
    });
  } catch (err: any) {
    console.error('[rerun] error', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
