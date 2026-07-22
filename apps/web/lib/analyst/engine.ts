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
}

export interface EngineTurnResult {
  text: string;
  toolCalls: ToolCallRecord[];
  iterations: number;
  usage: unknown;
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
  let finalUsage: unknown = null;

  // Prompt caching (brief §8.3): the system prompt + 22 tool defs are
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
  }

  finalUsage = response.usage;

  // The stream 'text' handler already accumulated every leg's text in
  // order, so join the parts rather than re-reading response.content —
  // intermediate legs' narration would otherwise be lost.
  const text = textParts.join('').trim();

  return { text, toolCalls: capturedToolCalls, iterations, usage: finalUsage, model };
}
