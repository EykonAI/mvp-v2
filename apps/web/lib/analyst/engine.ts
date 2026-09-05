// ─── AI ANALYST v2 — unified conversation engine (brief §8.1–8.2) ──
//
// THE one agentic tool-use loop. Replaces the duplicated loops that
// lived in /api/chat/route.ts and lib/intelligence-analyst/run.ts —
// both now delegate here, so model, tools, iteration cap and
// provenance capture can never drift between the docked panel, the
// /analyst workspace and the COMM in-room analyst.
//
// Streaming: every leg of the loop uses anthropic.messages.stream()
// and forwards text deltas + tool lifecycle events through onEvent.
// Callers that want a blocking JSON answer simply omit onEvent.

import { getAnthropic, toolsForTier, CONVERSATIONAL_SYSTEM_PROMPT } from '@/lib/anthropic';
import { executeToolCall } from '@/lib/tool-executor';
import { decorateSystemPrompt, isValidPersona } from '@/lib/intelligence-analyst/personas';
import {
  rowCountFromToolResult,
  type ToolCallRecord,
} from '@/lib/intelligence-analyst/persistence';
import type { Tier } from '@/lib/subscription';
import {
  DEFAULT_ANALYST_MODEL,
  ANALYST_MAX_TOKENS,
  ANALYST_MAX_ITERATIONS,
} from './model';
import type { AccUsage } from '@/lib/costs/prices';
import { recordLlmTurn, type MeterContext } from '@/lib/costs/meter';
import { debitTurn } from '@/lib/costs/wallet';

// Events forwarded to a streaming caller, in emission order:
//   text        — a streamed text delta from the model
//   tool_start  — the engine is about to execute a tool
//   tool_result — the tool returned (row_count for the provenance line)
export type EngineEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; row_count: number | null };

export interface EngineTurnInput {
  // Prior conversation, oldest first. Content may be a plain string
  // (a persisted turn) or content blocks (in-flight tool rounds).
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  tier: Tier;
  persona?: string;
  // Overrides DEFAULT_ANALYST_MODEL (e.g. a session pinned to the
  // Deep Analysis model). Callers validate tier entitlement first.
  model?: string;
  // analyst_projects.instructions — appended to the system prompt so
  // a project reads as a briefed analyst (brief §8.4). v1 surface;
  // plumbing landed now so the engine signature is stable.
  projectInstructions?: string;
  onEvent?: (ev: EngineEvent) => void;
  // Cost metering (migration 100). When present the engine records ONE
  // cost_events row for this turn, priced from the accumulated usage
  // below. Passed here rather than left to callers so metering cannot
  // be forgotten: every entry point delegates to this function.
  // Omit for work that should not be attributed to any user.
  meter?: MeterContext;
}

export interface EngineTurnResult {
  text: string;
  toolCalls: ToolCallRecord[];
  iterations: number;
  // Accumulated across EVERY leg of the tool-use loop — see the
  // accumulator below for why this is not the final leg's usage.
  usage: AccUsage;
  model: string;
}

export async function runAnalystTurn(input: EngineTurnInput): Promise<EngineTurnResult> {
  const model = input.model || DEFAULT_ANALYST_MODEL;
  const persona = isValidPersona(input.persona) ? input.persona : undefined;
  let systemPrompt = decorateSystemPrompt(CONVERSATIONAL_SYSTEM_PROMPT, persona);
  if (input.projectInstructions?.trim()) {
    systemPrompt += `\n\n## Project instructions (set by the user for this project)\n${input.projectInstructions.trim()}`;
  }

  const anthropic = getAnthropic();
  const tools = toolsForTier(input.tier);
  const emit = input.onEvent ?? (() => {});

  const conversation = input.messages.map((m) => ({ role: m.role, content: m.content as any }));

  const capturedToolCalls: ToolCallRecord[] = [];
  const textParts: string[] = [];
  let iterations = 0;

  // ── Usage accumulator (migration 100) ────────────────────────────
  // This loop runs up to 1 + ANALYST_MAX_ITERATIONS legs against the
  // API. The previous `finalUsage = response.usage` after the loop
  // captured the LAST leg only and silently discarded every earlier
  // one, so a tool-heavy turn could bill a fraction of its true cost —
  // the field was populated, rendered fine, and was wrong.
  //
  // Note the textParts comment further down: the same lesson was
  // already learned for the turn's TEXT and never applied to usage.
  //
  // All four token classes are summed because prompt caching is ON for
  // the system block: cache reads bill ~0.1x and cache writes ~1.25x,
  // so input+output alone misprices every multi-turn session.
  const acc: AccUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    legs: 0,
  };
  function addUsage(u: any) {
    if (!u) {
      // Never silently treat a missing usage object as zero — that
      // under-reports cost in exactly the direction that looks healthy.
      console.warn('[costs] engine leg returned no usage object; cost under-reported');
      return;
    }
    acc.input_tokens += u.input_tokens ?? 0;
    acc.output_tokens += u.output_tokens ?? 0;
    acc.cache_write_tokens += u.cache_creation_input_tokens ?? 0;
    acc.cache_read_tokens += u.cache_read_input_tokens ?? 0;
    acc.legs += 1;
  }

  // Prompt caching (brief §8.3): the system prompt + the tool defs are
  // large and static within a session. A cache_control breakpoint on
  // the system block caches tools + system together (render order is
  // tools → system → messages), so legs 2+ of the loop and turns 2+ of
  // the session read them at ~0.1x instead of full price. Cast because
  // SDK 0.32.1 predates the typed cache_control on the system block;
  // the field is sent on the wire (the notifications evaluator already
  // relies on this on 0.32).
  const cachedSystem = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
  ] as any;

  // One streamed leg of the loop. Emits text deltas as they arrive
  // and resolves with the fully-accumulated message.
  async function streamLeg() {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: ANALYST_MAX_TOKENS,
      system: cachedSystem,
      tools,
      messages: conversation as any,
      // Sonnet 5 / Opus 4.8 run adaptive thinking by DEFAULT. In the
      // tool-use loop the assistant content is echoed back for the
      // next leg; a default display:"omitted" thinking block replays
      // with empty text and the API rejects it (400 "each thinking
      // block must contain thinking"). The analyst is a tool-
      // orchestration + synthesis task and does not need extended
      // thinking (v1 ran without it), so disable it — accepted on
      // both Sonnet 5 and Opus 4.8. Spread-cast because the installed
      // SDK 0.32.1 predates the `thinking` param in its types; the
      // field is still sent on the wire.
      ...({ thinking: { type: 'disabled' } } as any),
    });
    stream.on('text', (delta: string) => {
      textParts.push(delta);
      emit({ type: 'text', text: delta });
    });
    return stream.finalMessage();
  }

  let response = await streamLeg();
  addUsage(response.usage);

  while (response.stop_reason === 'tool_use' && iterations < ANALYST_MAX_ITERATIONS) {
    iterations++;

    const toolUseBlocks = response.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: unknown } =>
        b.type === 'tool_use',
    );

    // Echo the assistant content back for the tool-result leg, with
    // thinking/redacted_thinking blocks stripped. Thinking is disabled
    // (see streamLeg), so this is a no-op on the happy path — but it
    // permanently closes the "each thinking block must contain thinking"
    // 400: a display:"omitted" thinking block replays with empty text
    // and is rejected. With thinking off the model doesn't expect the
    // blocks back, so dropping them is safe and the tool_use blocks
    // (all that matters for continuation) are retained.
    const echoContent = (response.content as Array<{ type: string }>).filter(
      (b) => b.type !== 'thinking' && b.type !== 'redacted_thinking',
    );
    conversation.push({ role: 'assistant', content: echoContent });

    const toolResults: any[] = [];
    for (const toolUse of toolUseBlocks) {
      const inputRecord = (toolUse.input ?? {}) as Record<string, any>;
      emit({ type: 'tool_start', name: toolUse.name, input: inputRecord });
      const result = await executeToolCall(toolUse.name, inputRecord);
      const rowCount = rowCountFromToolResult(result);
      capturedToolCalls.push({ name: toolUse.name, input: inputRecord, row_count: rowCount });
      emit({ type: 'tool_result', name: toolUse.name, row_count: rowCount });
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
    }

    conversation.push({ role: 'user', content: toolResults });

    response = await streamLeg();
    addUsage(response.usage);
  }

  // The stream 'text' handler already accumulated every leg's text in
  // order, so join the parts rather than re-reading response.content —
  // intermediate legs' narration would otherwise be lost.
  const text = textParts.join('').trim();

  // Record the turn's cost before returning. Awaited so the row is
  // written even on serverless routes that freeze after the response;
  // recordLlmTurn never throws, so a ledger failure cannot cost the
  // user their completed answer.
  if (input.meter) {
    // recordLlmTurn returns the price it already computed. Reusing it
    // rather than calling priceUsage() again matters: that call throws
    // on an unknown model id, and a second, unguarded call here would
    // destroy a completed turn over a gap in the rate card.
    const usdCost = await recordLlmTurn(input.meter, model, acc);
    // Debit the wallet with the ACTUAL cost (migration 101). No-op for
    // the ~all users with no wallet row. Post-flight because LLM cost
    // is only knowable after the call — the pre-flight reserve in
    // access.ts is what keeps the resulting overshoot to one turn.
    if (usdCost !== null) {
      await debitTurn(input.meter.userId, model, usdCost);
    }
  }

  return { text, toolCalls: capturedToolCalls, iterations, usage: acc, model };
}
