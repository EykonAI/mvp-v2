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
  coercePredicate,
  isValidDataBucket,
  isValidSingleEventTool,
  suggestAiRuleName,
  suggestMultiEventRuleName,
  suggestRuleName,
  type DataBucket,
  type MultiEventConfig,
  type SingleEventToolId,
  AI_K_EVENTS_DEFAULT,
  AI_K_EVENTS_MAX,
  CROSS_DATA_AI_MIN_BUCKETS,
  MULTI_EVENT_MIN_PREDICATES,
  MULTI_EVENT_MAX_PREDICATES,
  MULTI_EVENT_DEFAULT_WINDOW_HOURS,
  MULTI_EVENT_MIN_WINDOW_HOURS,
  MULTI_EVENT_MAX_WINDOW_HOURS,
  OUTCOME_STATEMENT_MAX_CHARS,
  OUTCOME_STATEMENT_MIN_CHARS,
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

const ALLOWED_RULE_TYPES = new Set([
  'single_event',
  'multi_event',
  'outcome_ai',
  'cross_data_ai',
]);

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
    // single_event
    tool?: string;
    filters?: Record<string, unknown>;
    // multi_event
    predicates?: Array<{ tool?: unknown; filters?: Record<string, unknown> }>;
    window_hours?: number;
    // outcome_ai / cross_data_ai
    outcome_statement?: string;
    k_events?: number;
    buckets?: unknown;
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

  if (!body.rule_type || !ALLOWED_RULE_TYPES.has(body.rule_type)) {
    return NextResponse.json(
      {
        error: 'unsupported_rule_type',
        allowed: Array.from(ALLOWED_RULE_TYPES),
        hint: 'outcome_ai and cross_data_ai land in PR 8.',
      },
      { status: 400 },
    );
  }

  let savedConfig: Record<string, unknown>;
  let derivedName: string;

  if (body.rule_type === 'single_event') {
    const toolId = body.config?.tool;
    if (!isValidSingleEventTool(toolId)) {
      return NextResponse.json({ error: 'invalid_tool' }, { status: 400 });
    }
    const filters = coerceFilters(toolId as SingleEventToolId, body.config?.filters ?? {});
    savedConfig = { tool: toolId, filters };
    derivedName = suggestRuleName(toolId as SingleEventToolId, filters);
  } else if (body.rule_type === 'outcome_ai' || body.rule_type === 'cross_data_ai') {
    const outcome = (body.config?.outcome_statement ?? '').trim();
    if (outcome.length < OUTCOME_STATEMENT_MIN_CHARS) {
      return NextResponse.json(
        { error: 'outcome_statement_too_short', min: OUTCOME_STATEMENT_MIN_CHARS },
        { status: 400 },
      );
    }
    if (outcome.length > OUTCOME_STATEMENT_MAX_CHARS) {
      return NextResponse.json(
        { error: 'outcome_statement_too_long', max: OUTCOME_STATEMENT_MAX_CHARS },
        { status: 400 },
      );
    }
    const rawBuckets = Array.isArray(body.config?.buckets) ? body.config!.buckets : [];
    const buckets: DataBucket[] = [];
    for (const b of rawBuckets) {
      if (isValidDataBucket(b) && !buckets.includes(b)) buckets.push(b);
    }
    if (body.rule_type === 'cross_data_ai' && buckets.length < CROSS_DATA_AI_MIN_BUCKETS) {
      return NextResponse.json(
        { error: 'too_few_buckets', min: CROSS_DATA_AI_MIN_BUCKETS },
        { status: 400 },
      );
    }
    if (body.rule_type === 'outcome_ai') {
      const k = Number(body.config?.k_events);
      const k_events = Number.isFinite(k) && k > 0
        ? Math.min(AI_K_EVENTS_MAX, Math.floor(k))
        : AI_K_EVENTS_DEFAULT;
      savedConfig = { outcome_statement: outcome, k_events, buckets };
    } else {
      savedConfig = { outcome_statement: outcome, buckets };
    }
    derivedName = suggestAiRuleName(body.rule_type, outcome);
  } else {
    // multi_event
    const rawPreds = Array.isArray(body.config?.predicates) ? body.config!.predicates! : [];
    if (rawPreds.length < MULTI_EVENT_MIN_PREDICATES) {
      return NextResponse.json(
        { error: 'too_few_predicates', min: MULTI_EVENT_MIN_PREDICATES },
        { status: 400 },
      );
    }
    if (rawPreds.length > MULTI_EVENT_MAX_PREDICATES) {
      return NextResponse.json(
        { error: 'too_many_predicates', max: MULTI_EVENT_MAX_PREDICATES },
        { status: 400 },
      );
    }
    const predicates: Array<{ tool: string; filters: Record<string, unknown> }> = [];
    for (const raw of rawPreds) {
      const p = coercePredicate(raw);
      if (!p) {
        return NextResponse.json({ error: 'invalid_predicate' }, { status: 400 });
      }
      predicates.push(p);
    }
    const windowHoursRaw = Number(body.config?.window_hours ?? MULTI_EVENT_DEFAULT_WINDOW_HOURS);
    const windowHours = Math.min(
      MULTI_EVENT_MAX_WINDOW_HOURS,
      Math.max(MULTI_EVENT_MIN_WINDOW_HOURS, Math.floor(windowHoursRaw)),
    );
    savedConfig = { predicates, window_hours: windowHours };
    derivedName = suggestMultiEventRuleName(savedConfig as unknown as MultiEventConfig);
  }

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
  const name = (body.name ?? '').trim() || derivedName;

  const { data: inserted, error: insertError } = await supabase
    .from('user_notification_rules')
    .insert({
      user_id: user.id,
      name,
      rule_type: body.rule_type,
      config: savedConfig,
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
