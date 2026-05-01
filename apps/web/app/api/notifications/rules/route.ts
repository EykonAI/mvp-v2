import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { getCurrentTier, tierMeetsRequirement } from '@/lib/subscription';
import {
  ACTIVE_RULE_LIMITS,
  DEFAULT_COOLDOWN_MINUTES,
  MIN_COOLDOWN_MINUTES,
} from '@/lib/notifications/rule-limits';
import {
  coerceFilters,
  isValidSingleEventTool,
  suggestRuleName,
  type SingleEventToolId,
} from '@/lib/notifications/tools';
import { isValidPersona } from '@/lib/intelligence-analyst/personas';

// /api/notifications/rules — list and create rules.
//
//   GET   → 200 { rules: [...] }       self-rows (RLS does the work).
//   POST  → 201 { rule: {...} }        single_event only in PR 5;
//                                      multi_event lands in PR 7,
//                                      outcome_ai / cross_data_ai
//                                      land in PR 8.
//
// Tier gate: Pro / Desk / Enterprise only — Citizens are 403'd.
// Active-rule cap enforced server-side before the insert (§10).

export const dynamic = 'force-dynamic';

const PR5_ALLOWED_RULE_TYPES = new Set(['single_event']);

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const tier = await getCurrentTier();
  if (!tierMeetsRequirement(tier, 'pro')) {
    return NextResponse.json({ error: 'forbidden', requiredTier: 'pro' }, { status: 403 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('user_notification_rules')
    .select(
      'id, name, rule_type, config, channel_ids, active, cooldown_minutes, persona, last_fired_at, created_at, updated_at',
    )
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

interface CreateBody {
  name?: string;
  rule_type?: string;
  persona?: string;
  cooldown_minutes?: number;
  channel_ids?: string[];
  active?: boolean;
  config?: {
    tool?: string;
    filters?: Record<string, unknown>;
  };
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const tier = await getCurrentTier();
  if (!tierMeetsRequirement(tier, 'pro')) {
    return NextResponse.json({ error: 'forbidden', requiredTier: 'pro' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as CreateBody | null;
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  if (!body.rule_type || !PR5_ALLOWED_RULE_TYPES.has(body.rule_type)) {
    return NextResponse.json(
      {
        error: 'unsupported_rule_type',
        allowed: Array.from(PR5_ALLOWED_RULE_TYPES),
        hint: 'multi_event lands in PR 7; outcome_ai and cross_data_ai land in PR 8.',
      },
      { status: 400 },
    );
  }

  // Validate single_event config.
  const toolId = body.config?.tool;
  if (!isValidSingleEventTool(toolId)) {
    return NextResponse.json({ error: 'invalid_tool' }, { status: 400 });
  }
  const filters = coerceFilters(toolId as SingleEventToolId, body.config?.filters ?? {});

  // Cooldown floor matches the DB CHECK constraint. We re-check here
  // so the API returns a friendly error instead of a Postgres-level
  // CHECK violation.
  const cooldown = Math.max(
    MIN_COOLDOWN_MINUTES,
    Math.floor(body.cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES),
  );

  // Channel ids must be non-empty UUIDs and belong to the caller —
  // the SELECT below filters by user via RLS, so any id that doesn't
  // resolve gets dropped before insert.
  const requestedIds = Array.isArray(body.channel_ids) ? body.channel_ids : [];
  if (requestedIds.length === 0) {
    return NextResponse.json({ error: 'no_channels' }, { status: 400 });
  }

  const supabase = getServerSupabase();

  const { data: ownedChannels, error: chError } = await supabase
    .from('user_channels')
    .select('id, verified_at, active')
    .in('id', requestedIds);
  if (chError) {
    return NextResponse.json({ error: chError.message }, { status: 500 });
  }
  const usableChannelIds = (ownedChannels ?? [])
    .filter(c => c.verified_at && c.active)
    .map(c => c.id);
  if (usableChannelIds.length === 0) {
    return NextResponse.json({ error: 'no_verified_channels' }, { status: 400 });
  }

  // Active-rule cap (§10). Counts only rules with active=true so a
  // user can stash extra paused rules without hitting the cap.
  const { count: activeCount, error: countError } = await supabase
    .from('user_notification_rules')
    .select('id', { count: 'exact', head: true })
    .eq('active', true);
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  const wantsActive = body.active !== false;
  const limit = ACTIVE_RULE_LIMITS[tier];
  if (wantsActive && (activeCount ?? 0) >= limit) {
    return NextResponse.json(
      { error: 'rule_limit_reached', limit, tier },
      { status: 409 },
    );
  }

  const persona = isValidPersona(body.persona) ? body.persona : null;
  const name = (body.name ?? '').trim() || suggestRuleName(toolId as SingleEventToolId, filters);

  const { data: inserted, error: insertError } = await supabase
    .from('user_notification_rules')
    .insert({
      user_id: user.id,
      name,
      rule_type: 'single_event',
      config: { tool: toolId, filters },
      channel_ids: usableChannelIds,
      active: wantsActive,
      cooldown_minutes: cooldown,
      persona,
    })
    .select(
      'id, name, rule_type, config, channel_ids, active, cooldown_minutes, persona, last_fired_at, created_at, updated_at',
    )
    .single();

  if (insertError || !inserted) {
    return NextResponse.json(
      { error: insertError?.message ?? 'insert_failed' },
      { status: 500 },
    );
  }
  return NextResponse.json({ rule: inserted }, { status: 201 });
}
