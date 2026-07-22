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

  // One streamed leg of the loop. Emits text deltas as they arrive
  // and resolves with the fully-accumulated message.
  async function streamLeg() {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: ANALYST_MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages: conversation as any,
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

    // Echo the full assistant content (including any thinking blocks —
    // required for multi-turn continuity on the same model).
    conversation.push({ role: 'assistant', content: response.content });

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
