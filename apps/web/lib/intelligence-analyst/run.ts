import { getAnthropic, toolsForTier, CONVERSATIONAL_SYSTEM_PROMPT } from '@/lib/anthropic';
import { executeToolCall } from '@/lib/tool-executor';
import { decorateSystemPrompt, isValidPersona } from '@/lib/intelligence-analyst/personas';
import type { Tier } from '@/lib/subscription';

// Reusable, server-side invocation of the AI Analyst (COMM D3). This is a
// pure helper — given a prompt it runs the same agentic tool-use loop as
// /api/chat and returns the final text. It deliberately MIRRORS
// /api/chat/route.ts (same model, max_tokens, system prompt, tier-gated
// tool surface and loop) so the in-room analyst behaves identically to the
// main chat analyst. If the analyst's model/tools change, change them in
// BOTH places. The rate-limit / usage-counter / persistence wrapper stays
// in /api/chat; this helper has no HTTP coupling.

const ANALYST_MODEL = 'claude-sonnet-4-5'; // keep in sync with /api/chat
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 5;

export interface AnalystResult {
  text: string;
  toolCalls: number;
  usage: unknown;
}

export async function runAnalyst(opts: {
  prompt: string;
  tier?: Tier;
  persona?: string;
}): Promise<AnalystResult> {
  const tier: Tier = opts.tier ?? 'pro';
  const persona = isValidPersona(opts.persona) ? opts.persona : undefined;
  const systemPrompt = decorateSystemPrompt(CONVERSATIONAL_SYSTEM_PROMPT, persona);

  const anthropic = getAnthropic();
  const tools = toolsForTier(tier);

  const messages: { role: 'user' | 'assistant'; content: any }[] = [
    { role: 'user', content: opts.prompt },
  ];

  let response = await anthropic.messages.create({
    model: ANALYST_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    tools,
    messages,
  });

  let iterations = 0;
  while (response.stop_reason === 'tool_use' && iterations < MAX_ITERATIONS) {
    iterations++;

    const toolUseBlocks = response.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: unknown } => b.type === 'tool_use',
    );

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: any[] = [];
    for (const toolUse of toolUseBlocks) {
      const result = await executeToolCall(toolUse.name, toolUse.input as Record<string, any>);
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
    }

    messages.push({ role: 'user', content: toolResults });

    response = await anthropic.messages.create({
      model: ANALYST_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages,
    });
  }

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();

  return { text, toolCalls: iterations, usage: response.usage };
}
