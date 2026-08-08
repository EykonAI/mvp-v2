import { NextResponse } from 'next/server';
import { getCurrentTier } from '@/lib/subscription';
import { getCurrentUser } from '@/lib/auth/session';
import { getWallet } from '@/lib/costs/wallet';
import {
  DEFAULT_ANALYST_MODEL,
  DEEP_ANALYSIS_MODEL,
  modelLabel,
} from '@/lib/analyst/model';

// GET /api/analyst/config
//
// The UI's window into the model config (brief §8.7): the badge in
// the docked panel and the workspace header render THESE values, so
// the interface can never name a model the code does not call.
// Also carries the caller's effective tier so client components can
// shape the gating UX without a second round-trip.

// Per-request: tier comes from the caller's cookie session; without
// this Next would statically bake the build-time answer.
export const dynamic = 'force-dynamic';

export async function GET() {
  const tier = await getCurrentTier();

  // Credit wallet (migration 101). NULL for every user without a
  // founder-granted metered test plan, so the balance UI simply does
  // not render for them. Carried here rather than on a separate
  // endpoint so the workspace hydrates its balance in the same
  // round-trip it already makes for the model badge.
  let balance = null;
  const user = await getCurrentUser();
  if (user) {
    const wallet = await getWallet(user.id);
    if (wallet) {
      balance = {
        budget_usd: wallet.budgetUsd,
        spent_usd: wallet.spentUsd,
        remaining_usd: wallet.remainingUsd,
        deep_cap_usd: wallet.deepCapUsd,
        deep_spent_usd: wallet.deepSpentUsd,
        deep_remaining_usd: wallet.deepRemainingUsd,
        status: wallet.status,
        label: wallet.label,
      };
    }
  }

  return NextResponse.json({
    model: DEFAULT_ANALYST_MODEL,
    model_label: modelLabel(DEFAULT_ANALYST_MODEL),
    deep_model: DEEP_ANALYSIS_MODEL,
    deep_model_label: modelLabel(DEEP_ANALYSIS_MODEL),
    tier,
    balance,
  });
}
