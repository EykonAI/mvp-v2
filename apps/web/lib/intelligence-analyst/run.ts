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
  /** The model that actually ran — echo it in logs rather than
   *  assuming the default, so an env override is visible in ops. */
  model: string;
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
  // Overrides DEFAULT_ANALYST_MODEL for this call. Pass one of the
  // named constants from lib/analyst/model.ts — never a literal, so a
  // model swap stays a config change rather than a code hunt.
  // Used by the anomaly-report cron (ANOMALY_REPORT_MODEL).
  model?: string;
}): Promise<AnalystResult> {
  const result = await runAnalystTurn({
    messages: [{ role: 'user', content: opts.prompt }],
    tier: opts.tier ?? 'pro',
    persona: opts.persona,
    meter: opts.meter,
    model: opts.model,
  });
  return {
    text: result.text,
    toolCalls: result.iterations,
    usage: result.usage,
    model: result.model,
  };
}
