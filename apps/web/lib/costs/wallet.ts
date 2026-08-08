// ─── Cost metering — the credit wallet ──────────────────────────
//
// The enforcement half of the metered FP test plan (migration 101).
// PR-1 records; this decides whether a turn may run and debits it
// afterwards.
//
// NO WALLET ROW = UNMETERED. The vast majority of users have no row
// here and are governed entirely by their tier's query limits, exactly
// as before. The wallet is an overlay for founder-granted test plans,
// not a replacement for the tier ladder — so every helper below is a
// no-op when the row is absent, and absence is never an error.

import { createServerSupabase } from '@/lib/supabase-server';
import { estimateMaxTurnCost, type AccUsage } from './prices';
import { ANALYST_MAX_TOKENS, DEEP_ANALYSIS_MODEL } from '@/lib/analyst/model';

export interface WalletState {
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  deepCapUsd: number;
  deepSpentUsd: number;
  deepRemainingUsd: number;
  status: 'active' | 'exhausted' | 'suspended';
  label: string | null;
}

/** Null when the user is unmetered. */
export async function getWallet(userId: string): Promise<WalletState | null> {
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('user_credit_accounts')
    .select('budget_usd, spent_usd, deep_cap_pct, deep_spent_usd, status, label')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // Fail OPEN on a read error. A wallet lookup that 500s must not
    // lock a paying user out of the analyst; the debit path still
    // records the spend, so this cannot be used to get free turns
    // beyond the one that raced the outage.
    console.error('[costs] getWallet failed, treating as unmetered:', error.message);
    return null;
  }
  if (!data) return null;

  const budgetUsd = Number(data.budget_usd);
  const spentUsd = Number(data.spent_usd);
  const deepCapUsd = budgetUsd * Number(data.deep_cap_pct);
  const deepSpentUsd = Number(data.deep_spent_usd);

  return {
    budgetUsd,
    spentUsd,
    remainingUsd: Math.max(0, budgetUsd - spentUsd),
    deepCapUsd,
    deepSpentUsd,
    deepRemainingUsd: Math.max(0, deepCapUsd - deepSpentUsd),
    status: data.status as WalletState['status'],
    label: data.label ?? null,
  };
}

export type DenialReason =
  | 'exhausted'      // main budget gone
  | 'suspended'      // founder kill-switch
  | 'deep_exhausted' // Deep sub-cap gone; ordinary turns still fine
  | 'insufficient';  // remaining < reserve for one more turn

export interface SpendDecision {
  allowed: boolean;
  reason?: DenialReason;
  wallet: WalletState | null;
  /** Worst-case cost of the turn that was checked. */
  reserveUsd?: number;
}

/**
 * Pre-flight check. LLM cost is only knowable after the call, so this
 * asks "could one more turn fit?" rather than "does this turn fit?".
 *
 * Requires remaining >= estimateMaxTurnCost rather than remaining > 0.
 * Without the reserve, the final turn could overshoot the budget by a
 * full Opus turn — bounded overshoot is accepted, unbounded is not.
 */
export async function canSpend(
  userId: string,
  model: string,
): Promise<SpendDecision> {
  const wallet = await getWallet(userId);
  if (!wallet) return { allowed: true, wallet: null };

  if (wallet.status === 'suspended') {
    return { allowed: false, reason: 'suspended', wallet };
  }
  if (wallet.status === 'exhausted' || wallet.remainingUsd <= 0) {
    return { allowed: false, reason: 'exhausted', wallet };
  }

  const isDeep = model === DEEP_ANALYSIS_MODEL;
  const reserveUsd = estimateMaxTurnCost(model, ANALYST_MAX_TOKENS);

  // The Deep sub-cap binds INDEPENDENTLY: when it is gone, Deep
  // refuses while ordinary Sonnet turns continue on the main budget.
  if (isDeep && wallet.deepRemainingUsd <= 0) {
    return { allowed: false, reason: 'deep_exhausted', wallet, reserveUsd };
  }
  if (wallet.remainingUsd < reserveUsd) {
    return { allowed: false, reason: 'insufficient', wallet, reserveUsd };
  }
  return { allowed: true, wallet, reserveUsd };
}

export interface DebitResult {
  ok: boolean;
  spent: number | null;
  budget: number | null;
  deepSpent: number | null;
  deepCap: number | null;
  status: string | null;
  /** True when this debit is what tipped the account over. */
  justExhausted: boolean;
}

/**
 * Post-flight debit. Atomic (migration 101). Never throws — a debit
 * failure must not cost a user their completed answer, and the cost is
 * already in cost_events either way, so the ledger stays the source of
 * truth for reconciliation.
 */
export async function debitCredit(
  userId: string,
  usdCost: number,
  isDeep: boolean,
): Promise<DebitResult | null> {
  try {
    const admin = createServerSupabase();
    const { data, error } = await admin.rpc('debit_credit', {
      p_user_id: userId,
      p_usd: usdCost,
      p_is_deep: isDeep,
    });
    if (error) {
      console.error('[costs] debit_credit failed:', error.message, { userId, usdCost });
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    const status = row.status ?? null;
    return {
      ok: row.ok === true,
      spent: row.spent === null ? null : Number(row.spent),
      budget: row.budget === null ? null : Number(row.budget),
      deepSpent: row.deep_spent === null ? null : Number(row.deep_spent),
      deepCap: row.deep_cap === null ? null : Number(row.deep_cap),
      status,
      justExhausted: status === 'exhausted',
    };
  } catch (err: any) {
    console.error('[costs] debitCredit threw:', err?.message);
    return null;
  }
}

/** Convenience for the engine: price is already computed upstream. */
export async function debitTurn(
  userId: string | null,
  model: string,
  usdCost: number,
): Promise<void> {
  if (!userId) return;
  await debitCredit(userId, usdCost, model === DEEP_ANALYSIS_MODEL);
}

// ─── Client-facing refusal copy ──────────────────────────────────
// Fail LOUD and honestly. A refused turn states the reason and the
// remaining balance in plain language: a spinner or a generic error on
// an exhausted balance reads to an evaluating Founding Partner as a
// broken product, which is a far worse outcome than the cap itself.
export function denialCopy(
  reason: DenialReason,
  wallet: WalletState,
): { error: string; detail: string } {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  switch (reason) {
    case 'suspended':
      return {
        error: 'This test plan is paused.',
        detail: 'Your access is paused by the eYKON team. Everything else on the platform still works — the globe, all nine INTEL workspaces, BRIEFS and COMM are unaffected.',
      };
    case 'deep_exhausted':
      return {
        error: 'Deep Analysis allowance used up.',
        detail: `Deep Analysis is capped at ${fmt(wallet.deepCapUsd)} of your ${fmt(wallet.budgetUsd)} plan and you have used it. Ordinary analyst turns still work — you have ${fmt(wallet.remainingUsd)} of general balance left.`,
      };
    case 'exhausted':
    case 'insufficient':
    default:
      return {
        error: 'Analyst balance used up.',
        detail: `You have used ${fmt(wallet.spentUsd)} of your ${fmt(wallet.budgetUsd)} plan. The analyst is paused until it is topped up — everything else stays open: the globe and all live layers, all nine INTEL workspaces, BRIEFS, COMM, and every insight you have already saved.`,
      };
  }
}
