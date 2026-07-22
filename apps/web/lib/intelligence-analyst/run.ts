import type { Tier } from '@/lib/subscription';
import { runAnalystTurn } from '@/lib/analyst/engine';

// Reusable, server-side invocation of the AI Analyst (COMM D3).
// Since AI ANALYST v2 this is a thin wrapper over the ONE unified
// engine in lib/analyst/engine.ts — the same loop, model config and
// tool surface as /api/chat and /api/analyst/sessions/[id]/messages.
// There is nothing left here to "keep in sync": model ids live only
// in lib/analyst/model.ts (brief §8.7).

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
  const result = await runAnalystTurn({
    messages: [{ role: 'user', content: opts.prompt }],
    tier: opts.tier ?? 'pro',
    persona: opts.persona,
  });
  return { text: result.text, toolCalls: result.iterations, usage: result.usage };
}
