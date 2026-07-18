import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { getCurrentTier } from '@/lib/subscription';
import {
  ACTIVE_RULE_LIMITS,
  DEFAULT_COOLDOWN_MINUTES,
  MIN_COOLDOWN_MINUTES,
} from '@/lib/notifications/rule-limits';
import {
  coerceFilters,
  coercePredicate,
  isAggregatableBucket,
  isAggregateMetricDeferred,
  isAggregateMetricSupported,
  isAggregateThresholdKindDeferred,
  isAggregateThresholdKindSupported,
  isValidDataBucket,
  isValidSingleEventTool,
  suggestAiRuleName,
  suggestMultiEventRuleName,
  suggestRuleName,
  type DataBucket,
  type MultiEventConfig,
  type SingleEventToolId,
  AGGREGATE_COLUMN_NAME_MAX_CHARS,
  AGGREGATE_WINDOW_HOURS_MAX,
  AGGREGATE_WINDOW_HOURS_MIN,
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
  RULE_COUNTRY_FILTER_MAX_CHARS,
} from '@/lib/notifications/tools';
import {
  getRuleCoverage,
  normaliseFirmsConfig,
  suggestFirmsRuleName,
  FIRMS_MAX_RADIUS_KM,
  FIRMS_MIN_RADIUS_KM,
  type FirmsProximityConfig,
} from '@/lib/notifications/firms-proximity';
import { createServerSupabase } from '@/lib/supabase-server';
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
  'aggregate',
  'firms_proximity',
]);

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // Citizens listed alongside Pro+ per the trial-mechanism brief §5.3:
  // Observer users get one email-only rule. The ACTIVE_RULE_LIMITS map
  // and the channel-type gate on POST do the constraining.

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
    /** Optional per-rule country narrowing (PR 2 — AI rules only). */
    country?: string;
    // aggregate (PR 5)
    bucket?: unknown;
    filter?: Record<string, unknown>;
    metric?: unknown;
    distinct_on?: unknown;
    metric_field?: unknown;
    threshold_kind?: unknown;
    threshold_value?: unknown;
    baseline_window_hours?: unknown;
    // firms_proximity (084)
    facility_type?: unknown;
    facility_name?: unknown;
    radius_km?: unknown;
    min_frp?: unknown;
    min_detections?: unknown;
  };
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const tier = await getCurrentTier();
  // No tier 403 — Citizens can create one rule. The active-rule cap
  // below enforces the count and the channel resolution below enforces
  // email-only (verified email channel required; SMS/WA channels are
  // rejected at /api/notifications/channels POST for Citizens).

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
    // Optional per-rule country narrowing (PR 2). Accept any string up
    // to RULE_COUNTRY_FILTER_MAX_CHARS; the evaluator does an ILIKE so
    // both ISO-2 and short-name values work. Empty after trim → drop
    // the field entirely so existing rules round-trip unchanged.
    const countryRaw = typeof body.config?.country === 'string' ? body.config.country.trim() : '';
    if (countryRaw.length > RULE_COUNTRY_FILTER_MAX_CHARS) {
      return NextResponse.json(
        { error: 'country_filter_too_long', max: RULE_COUNTRY_FILTER_MAX_CHARS },
        { status: 400 },
      );
    }
    const countryField = countryRaw.length > 0 ? { country: countryRaw } : {};

    if (body.rule_type === 'outcome_ai') {
      const k = Number(body.config?.k_events);
      const k_events = Number.isFinite(k) && k > 0
        ? Math.min(AI_K_EVENTS_MAX, Math.floor(k))
        : AI_K_EVENTS_DEFAULT;
      savedConfig = { outcome_statement: outcome, k_events, buckets, ...countryField };
    } else {
      savedConfig = { outcome_statement: outcome, buckets, ...countryField };
    }
    derivedName = suggestAiRuleName(body.rule_type, outcome);
  } else if (body.rule_type === 'multi_event') {
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
  } else if (body.rule_type === 'firms_proximity') {
    // ─── NASA FIRMS thermal-anomaly proximity ────────────────────
    const parsed = normaliseFirmsConfig(
      body.config as Record<string, unknown> | undefined,
    );
    if ('error' in parsed) {
      return NextResponse.json(
        {
          error: parsed.error,
          ...(parsed.error === 'invalid_radius'
            ? {
                min_km: FIRMS_MIN_RADIUS_KM,
                max_km: FIRMS_MAX_RADIUS_KM,
                hint: `The facility roll-up is pre-computed at a fixed radius, so radii above ${FIRMS_MAX_RADIUS_KM} km cannot be answered and would silently under-report.`,
              }
            : {}),
        },
        { status: 400 },
      );
    }
    const firmsConfig = parsed.config;

    // Coverage gate. A firms_proximity rule can be silently dead in
    // two ways — no facility matches the filters at all, or the
    // facilities match but sit outside every FIRMS ingest bbox (China
    // has 39,796 facilities and none are ingested; their permanent
    // detection_count = 0 is indistinguishable from "quiet" unless we
    // check). Refuse to create either, rather than handing the user a
    // healthy-looking rule that cannot fire.
    const admin = createServerSupabase();
    const coverage = await getRuleCoverage(admin, firmsConfig);
    if (!coverage) {
      return NextResponse.json({ error: 'coverage_check_failed' }, { status: 503 });
    }
    if (coverage.matching === 0) {
      return NextResponse.json(
        {
          error: 'no_facilities_match_filter',
          matching_facilities: 0,
          hint: firmsConfig.country
            ? `No monitored facility matches that filter. Note that refinery country attribution is largely absent in this dataset (populated on 3 of 634 refineries), so country-scoped refinery rules resolve to nothing. Country filters are reliable for power plants.`
            : 'No monitored facility matches that filter.',
        },
        { status: 400 },
      );
    }
    if (coverage.monitored === 0) {
      return NextResponse.json(
        {
          error: 'no_facilities_in_ingest_coverage',
          matching_facilities: coverage.matching,
          monitored_facilities: 0,
          hint: `${coverage.matching} facilities match, but none fall inside a region FIRMS is ingested for (Russia/Ukraine, Arabian Gulf, Europe). Those facilities would report zero detections forever because no satellite query covers them — which is absence of observation, not absence of fire.`,
        },
        { status: 400 },
      );
    }

    // Partial coverage is allowed but recorded on the rule, so the UI
    // can state what is actually watched (e.g. Russia 971/1801 — the
    // ru-ua bbox stops at 60E) instead of implying full national
    // coverage.
    savedConfig = {
      ...(firmsConfig as unknown as Record<string, unknown>),
      coverage_at_creation: {
        matching_facilities: coverage.matching,
        monitored_facilities: coverage.monitored,
        checked_at: new Date().toISOString(),
      },
    };
    derivedName = suggestFirmsRuleName(firmsConfig);
  } else {
    // aggregate (PR 5)
    const bucket = body.config?.bucket;
    if (!isAggregatableBucket(bucket)) {
      return NextResponse.json({ error: 'invalid_bucket' }, { status: 400 });
    }
    // Metric — sum/avg are reserved but not yet implemented; reject
    // with a discriminated error so the client knows it's not a bug.
    const metric = body.config?.metric;
    if (isAggregateMetricDeferred(metric)) {
      return NextResponse.json(
        { error: 'metric_not_yet_supported', metric, supported: ['count_total', 'count_distinct'] },
        { status: 400 },
      );
    }
    if (!isAggregateMetricSupported(metric)) {
      return NextResponse.json({ error: 'invalid_metric' }, { status: 400 });
    }
    // distinct_on is required when metric='count_distinct'.
    let distinctOn: string | undefined;
    if (metric === 'count_distinct') {
      const raw = typeof body.config?.distinct_on === 'string'
        ? body.config.distinct_on.trim()
        : '';
      if (!raw) {
        return NextResponse.json({ error: 'distinct_on_required' }, { status: 400 });
      }
      if (raw.length > AGGREGATE_COLUMN_NAME_MAX_CHARS) {
        return NextResponse.json(
          { error: 'distinct_on_too_long', max: AGGREGATE_COLUMN_NAME_MAX_CHARS },
          { status: 400 },
        );
      }
      distinctOn = raw;
    }
    // Threshold kind — sigma deferred (needs the baselines cache).
    const thresholdKind = body.config?.threshold_kind;
    if (isAggregateThresholdKindDeferred(thresholdKind)) {
      return NextResponse.json(
        {
          error: 'threshold_kind_not_yet_supported',
          threshold_kind: thresholdKind,
          supported: ['absolute_above', 'absolute_below', 'pct_change_vs_prev_window'],
        },
        { status: 400 },
      );
    }
    if (!isAggregateThresholdKindSupported(thresholdKind)) {
      return NextResponse.json({ error: 'invalid_threshold_kind' }, { status: 400 });
    }
    // Threshold value must be a positive finite number.
    const thresholdValue = Number(body.config?.threshold_value);
    if (!Number.isFinite(thresholdValue) || thresholdValue <= 0) {
      return NextResponse.json({ error: 'invalid_threshold_value' }, { status: 400 });
    }
    // Window bounds.
    const rawWindow = Number(body.config?.window_hours);
    if (!Number.isFinite(rawWindow)) {
      return NextResponse.json({ error: 'invalid_window_hours' }, { status: 400 });
    }
    const windowHours = Math.min(
      AGGREGATE_WINDOW_HOURS_MAX,
      Math.max(AGGREGATE_WINDOW_HOURS_MIN, Math.floor(rawWindow)),
    );
    // Filter — only `country` is honored by the PR 5 evaluator; other
    // keys are accepted and persisted for forward compatibility.
    const filterIn = (body.config?.filter ?? {}) as Record<string, unknown>;
    const filterCountryRaw = typeof filterIn.country === 'string'
      ? filterIn.country.trim()
      : '';
    if (filterCountryRaw.length > RULE_COUNTRY_FILTER_MAX_CHARS) {
      return NextResponse.json(
        { error: 'country_filter_too_long', max: RULE_COUNTRY_FILTER_MAX_CHARS },
        { status: 400 },
      );
    }
    const filterOut: Record<string, unknown> = {};
    if (filterCountryRaw) filterOut.country = filterCountryRaw;
    // Forward-compat pass-through (string fields only — defensive).
    for (const key of ['event_type', 'vessel_class', 'commodity'] as const) {
      const v = filterIn[key];
      if (typeof v === 'string' && v.trim()) filterOut[key] = v.trim();
    }
    for (const key of ['min_fatalities', 'min_capacity_mw', 'min_capacity_bpd'] as const) {
      const v = Number(filterIn[key]);
      if (Number.isFinite(v) && v >= 0) filterOut[key] = v;
    }
    savedConfig = {
      bucket,
      metric,
      ...(distinctOn ? { distinct_on: distinctOn } : {}),
      window_hours: windowHours,
      threshold_kind: thresholdKind,
      threshold_value: thresholdValue,
      ...(Object.keys(filterOut).length ? { filter: filterOut } : {}),
    };
    derivedName = `Aggregate · ${bucket}${
      filterCountryRaw ? ` (${filterCountryRaw})` : ''
    } · ${metric}${distinctOn ? ` ${distinctOn}` : ''} · ${windowHours}h`;
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
