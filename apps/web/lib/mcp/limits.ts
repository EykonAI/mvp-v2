// ─── MCP daily quota (migration 118) ─────────────────────────────
//
// Founder decision 2026-09-05: Pro gets MCP at 50 calls/day.
//
// This is DELIBERATELY NOT usage_counters / increment_usage_counter.
// That instrument is keyed on date_trunc('month') and is the right
// home for the monthly AI-query allowance; a daily cap expressed as a
// monthly one permits burning the month in an afternoon, which is a
// different product from the one that was decided.
//
// It is also deliberately NOT lib/rate-limit.ts. Those helpers FAIL
// OPEN by design, because they guard silent capture paths where a
// buggy limiter must never break the flow. A billing-relevant quota
// has the opposite requirement: if the counter cannot be read, the
// safe answer is to refuse, not to give away unmetered access. This
// module fails CLOSED and says so in the refusal.

import { createServerSupabase } from '@/lib/supabase-server';
import type { Tier } from '@/lib/pricing';

/**
 * Calls per UTC calendar day, by effective tier.
 *
 * pro: 50 is the founder decision. member: 0 is the LITERAL reading of
 * that decision — "Pro gets MCP" — and is the conservative default; a
 * Member subset can be opened later without anyone having relied on it,
 * whereas closing it afterwards would be taking something away.
 *
 * desk and enterprise are scaled from pro rather than decided; they are
 * flagged in the PR as needing confirmation before either tier is sold
 * on the strength of them.
 */
export const MCP_DAILY_LIMITS: Record<Tier, number> = {
  citizen: 0,
  member: 0,
  pro: 50,
  desk: 250,
  enterprise: 1_000,
};

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
  /** ISO instant at which the window resets (next UTC midnight). */
  resetsAt: string;
  /** Seconds until reset — the Retry-After hint. */
  retryAfterSeconds: number;
}

/** Start of the current UTC calendar day. */
function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Next UTC midnight — when the allowance resets. */
function nextUtcMidnight(now = new Date()): Date {
  const d = startOfUtcDay(now);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * Reads the caller's usage for the current UTC day and decides.
 *
 * Read-then-write rather than an atomic RPC, which means a caller
 * firing many concurrent requests can overshoot the cap slightly. That
 * is accepted here and should not be silently forgotten: the cap is a
 * commercial allowance, not a safety control, and the overshoot is
 * bounded by in-flight concurrency. If MCP ever gates something where
 * exact enforcement matters, this needs to become a single atomic
 * function the way increment_usage_counter is.
 */
export async function checkDailyQuota(
  userId: string,
  tier: Tier,
): Promise<QuotaDecision> {
  const limit = MCP_DAILY_LIMITS[tier] ?? 0;
  const reset = nextUtcMidnight();
  const base: Omit<QuotaDecision, 'allowed' | 'used'> = {
    limit,
    resetsAt: reset.toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)),
  };

  // No allowance at all — no need to query.
  if (limit <= 0) return { ...base, allowed: false, used: 0 };

  const admin = createServerSupabase();
  const { count, error } = await admin
    .from('mcp_call_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('called_at', startOfUtcDay().toISOString());

  // FAIL CLOSED. An unreadable counter must not become unlimited
  // access. Throwing lets the route return a 5xx that names the cause,
  // rather than silently serving free calls — the inverse of the
  // fail-open contract in lib/rate-limit.ts, and the difference is
  // deliberate.
  if (error) {
    throw new Error(`MCP quota check failed: ${error.message}`);
  }

  const used = count ?? 0;
  return { ...base, allowed: used < limit, used };
}

/**
 * Records one call. Fire-and-forget at the call site: a logging
 * failure must not fail a request that already succeeded, but it IS
 * logged, because a silent logging failure would quietly turn the
 * quota off — exactly the looks-alive-but-isn't class in §16.3.
 */
export async function recordCall(entry: {
  userId: string;
  apiKeyId: string;
  toolName: string;
  ok: boolean;
  durationMs: number;
}): Promise<void> {
  const admin = createServerSupabase();
  const { error } = await admin.from('mcp_call_log').insert({
    user_id: entry.userId,
    api_key_id: entry.apiKeyId,
    tool_name: entry.toolName,
    ok: entry.ok,
    duration_ms: entry.durationMs,
  });
  if (error) {
    console.error('[mcp/limits] call log insert FAILED — quota is now under-counting:', error.message);
  }
}
