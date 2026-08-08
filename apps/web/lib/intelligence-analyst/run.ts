import type { Tier } from '@/lib/subscription';
import { runAnalystTurn } from '@/lib/analyst/engine';
import type { MeterContext } from '@/lib/costs/meter';

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
  // Cost metering (migration 100). Server-side callers say who the
  // cost belongs to and what kind of work it is:
  //   - COMM in-room analyst → { userId, feature: 'analyst_turn' }
  //   - AI rule evaluator    → { userId: <rule owner>, feature: 'rule_eval_ai', ref: <rule id> }
  //   - daily brief / newsjack → { userId: null, feature: 'editorial' | 'newsjack' }
  // Omitting it records nothing — acceptable only for work that is
  // genuinely not attributable, and worth revisiting if it shows up as
  // a gap between the ledger and the Anthropic invoice.
  meter?: MeterContext;
}): Promise<AnalystResult> {
  const result = await runAnalystTurn({
    messages: [{ role: 'user', content: opts.prompt }],
    tier: opts.tier ?? 'pro',
    persona: opts.persona,
    meter: opts.meter,
  });
  return { text: result.text, toolCalls: result.iterations, usage: result.usage };
}
