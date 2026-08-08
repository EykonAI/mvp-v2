// ─── Cost metering — recording ──────────────────────────────────
//
// One helper, called from the ONE analyst engine, so metering cannot
// be forgotten by a caller. /api/chat, /api/analyst/sessions/[id]/
// messages and the COMM in-room analyst all delegate to that engine,
// so covering it covers every entry point by construction.
//
// PR-1 SCOPE: RECORD ONLY. Nothing here blocks a turn or debits a
// balance — that is PR-2 (debit_credit RPC + pre-flight gate).
// Recording first is deliberate: it lets the $10 default be validated
// against measured cost before any cap can refuse a partner.

import { createServerSupabase } from '@/lib/supabase-server';
import {
  PRICE_VERSION,
  priceUsage,
  type AccUsage,
} from './prices';

export type CostCategory =
  | 'llm'
  | 'messaging'
  | 'onchain'
  | 'payment_fee'
  | 'infra'
  | 'other';

export type CostFeature =
  | 'analyst_turn'
  | 'deep_analysis'
  | 'auto_title'
  | 'rule_eval_ai'
  | 'editorial'
  | 'newsjack'
  | 'sms'
  | 'whatsapp'
  | 'email'
  | 'lock_deploy';

export interface MeterContext {
  /** NULL for platform-fixed work (editorial brief, newsjack) — those
   *  cost the same with zero users and must not be charged to anyone. */
  userId: string | null;
  feature: CostFeature;
  /** FALSE = tracked for profitability, never debited. Email digests
   *  are false by founder decision. Defaults per-feature below. */
  billable?: boolean;
  sessionId?: string;
  ref?: string;
}

// Features that are recorded for P&L but must NEVER move a balance.
const NON_BILLABLE_FEATURES: ReadonlySet<string> = new Set<string>([
  'email',
  'editorial',
  'newsjack',
]);

function defaultBillable(feature: CostFeature): boolean {
  return !NON_BILLABLE_FEATURES.has(feature);
}

export interface RecordCostInput extends MeterContext {
  category: CostCategory;
  usdCost: number;
  model?: string;
  usage?: AccUsage;
}

/**
 * Append one row to the cost ledger.
 *
 * NEVER throws to the caller. A failed ledger INSERT must not cost a
 * user their completed answer — but the reverse (a turn that runs
 * unrecorded) is the leak, so it logs at ERROR and is surfaced on the
 * admin cost page rather than swallowed silently.
 */
export async function recordCost(input: RecordCostInput): Promise<void> {
  try {
    const admin = createServerSupabase();
    const { error } = await admin.from('cost_events').insert({
      user_id: input.userId,
      category: input.category,
      feature: input.feature,
      billable: input.billable ?? defaultBillable(input.feature),
      usd_cost: input.usdCost,
      price_version: PRICE_VERSION,
      model: input.model ?? null,
      input_tokens: input.usage?.input_tokens ?? null,
      output_tokens: input.usage?.output_tokens ?? null,
      cache_write_tokens: input.usage?.cache_write_tokens ?? null,
      cache_read_tokens: input.usage?.cache_read_tokens ?? null,
      legs: input.usage?.legs ?? null,
      session_id: input.sessionId ?? null,
      ref: input.ref ?? null,
    });
    if (error) {
      console.error('[costs] recordCost INSERT failed:', error.message, {
        feature: input.feature,
        usd: input.usdCost,
      });
    }
  } catch (err: any) {
    console.error('[costs] recordCost threw:', err?.message);
  }
}

/**
 * Price an LLM turn and record it. The engine calls this; callers of
 * the engine only supply the MeterContext.
 *
 * An unknown model id throws inside priceUsage() — caught here and
 * logged loudly rather than recorded at zero, because a zero is a free
 * ride that would make an exhausted balance read as healthy.
 */
export async function recordLlmTurn(
  ctx: MeterContext,
  model: string,
  usage: AccUsage,
): Promise<void> {
  let usdCost: number;
  try {
    usdCost = priceUsage(model, usage);
  } catch (err: any) {
    console.error('[costs] pricing failed, NOT recording:', err?.message);
    return;
  }
  await recordCost({
    ...ctx,
    category: 'llm',
    usdCost,
    model,
    usage,
  });
}
