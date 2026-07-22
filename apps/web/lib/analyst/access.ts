// ─── AI ANALYST v2 — access + rate limiting (brief §4.1/§9.6) ────
//
// Plan gating, decided 2026-07-22: gate the LEVERAGE, not the
// continuity. Sessions + history reach Member; projects, export and
// Deep Analysis are Pro+. Every check reads the EFFECTIVE tier via
// getCurrentTier() (profile tier raised by an active tier_overrides
// row — Week Pass), never raw user_profiles.tier, so a top-up
// genuinely opens and cleanly re-locks.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase-server';
import { AI_QUERY_LIMITS, getCurrentTier, type Tier } from '@/lib/subscription';
import { captureServer } from '@/lib/analytics/server';

const TIER_RANK: Record<Tier, number> = {
  citizen: 0,
  member: 1,
  pro: 2,
  desk: 3,
  enterprise: 4,
};

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

export interface AnalystCaller {
  userId: string;
  tier: Tier;
}

// Resolves the caller and enforces the continuity gate (Member+ for
// any persisted-session surface). Returns a NextResponse on failure
// so routes can `if (r instanceof NextResponse) return r;`.
//
// When NEXT_PUBLIC_AUTH_ENABLED !== 'true' (dev), mirrors the rest of
// the app: synthetic pro tier, synthetic user id — the workspace is
// fully explorable locally but nothing real is written for others.
export async function requireSessionAccess(
  min: Tier = 'member',
): Promise<AnalystCaller | NextResponse> {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'true') {
    return { userId: '00000000-0000-0000-0000-000000000000', tier: 'pro' };
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const tier = await getCurrentTier();
  if (!tierAtLeast(tier, min)) {
    return NextResponse.json(
      {
        error:
          min === 'member'
            ? 'Persistent analyst sessions are available on Member and above.'
            : 'This feature is available on Pro and above.',
        tier,
        required_tier: min,
        upgrade_url: min === 'member' ? '/pricing?from=analyst_sessions' : '/pricing?from=analyst_pro',
      },
      { status: 403 },
    );
  }
  return { userId: user.id, tier };
}

// Atomic per-user monthly AI-query cap — the exact 429 contract the
// docked panel already understands (upgrade_url + pass_offer),
// factored out of /api/chat so the session routes and the legacy
// route can never drift.
export async function enforceAiQueryLimit(
  userId: string,
  tier: Tier,
): Promise<NextResponse | null> {
  // Dev short-circuit: synthetic caller has no usage_counters row.
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'true') return null;

  const limit = AI_QUERY_LIMITS[tier];
  const admin = createServerSupabase();
  const { data, error } = await admin.rpc('increment_usage_counter', {
    p_user_id: userId,
    p_counter: 'ai_queries',
    p_limit: limit,
  });
  if (error) {
    console.error('[analyst] increment_usage_counter failed', error.message);
    return NextResponse.json({ error: 'rate-limit check failed' }, { status: 500 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) {
    const upgrade_url =
      tier === 'citizen'
        ? '/pricing?from=ai_cap'
        : tier === 'member'
        ? '/pricing?from=ai_cap_member'
        : tier === 'pro'
        ? '/pricing?plan=desk_founding_annual'
        : undefined;
    const pass_offer =
      tier === 'citizen' || tier === 'member'
        ? {
            query_pack: { href: '/pricing?plan=query_pack_25', label: '+25 queries this month · $5' },
            week_pass: { href: '/pricing?plan=week_pass', label: '7 days of full Pro · $9' },
          }
        : undefined;
    return NextResponse.json(
      {
        error: `Monthly AI analyst limit reached (${limit} queries).`,
        used: row?.new_value ?? limit,
        limit,
        period_start: row?.period_start,
        tier,
        upgrade_url,
        pass_offer,
      },
      { status: 429 },
    );
  }
  void captureServer(userId, {
    event: 'ai_query',
    tier,
    queries_this_month: row?.new_value ?? undefined,
  });
  return null;
}
