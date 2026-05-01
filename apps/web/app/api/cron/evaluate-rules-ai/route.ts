import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  isCooldownActive,
  type RuleRow,
} from '@/lib/notifications/evaluator-cheap';
import {
  buildAiFirePayload,
  decideWithClaude,
  gatherEvents,
  resolveBuckets,
  resolveKEvents,
  truncateToTokenBudget,
} from '@/lib/notifications/evaluator-ai';
import { AI_INPUT_TOKEN_BUDGET } from '@/lib/notifications/tools';
import {
  dispatchToChannel,
  type DispatchOutcome,
  type VerifiedChannel,
} from '@/lib/notifications/dispatch';

// /api/cron/evaluate-rules-ai — runs every 1 hour.
//
// Brief §3.7 — split cadence: this route handles outcome_ai and
// cross_data_ai rule types via Claude; the cheap (15-min) route
// handles single_event and multi_event via pure SQL. Hourly cadence
// bounds Anthropic spend at ~24× per active rule per day.
//
// Per-rule cost cap: K=50 events / 8,000 input tokens (brief §10).
// Anthropic prompt caching enabled — see AI_EVALUATOR_SYSTEM_PROMPT
// in evaluator-ai.ts. The system prompt is cache_control: ephemeral
// so all rules processed in the same tick share the cached prefix.

export const dynamic = 'force-dynamic';
// Claude calls + per-bucket Supabase queries push past the 30-s
// default. 5-min ceiling matches the Intelligence Center crons.
export const maxDuration = 300;

const MAX_RULES_PER_TICK = 80;

type ProcessResult =
  | {
      state: 'fired';
      ruleId: string;
      logId: string | null;
      usage: AiUsage | null;
    }
  | { state: 'no_match'; ruleId: string; usage: AiUsage | null }
  | { state: 'cooldown'; ruleId: string }
  | { state: 'skipped'; ruleId: string; reason: string }
  | { state: 'error'; ruleId: string; error: string };

interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const admin = createServerSupabase();

  const { data: rules, error: rulesErr } = await admin
    .from('user_notification_rules')
    .select(
      'id, user_id, name, rule_type, config, channel_ids, active, cooldown_minutes, last_fired_at, created_at',
    )
    .eq('active', true)
    .in('rule_type', ['outcome_ai', 'cross_data_ai'])
    .order('last_fired_at', { ascending: true, nullsFirst: true })
    .limit(MAX_RULES_PER_TICK);

  if (rulesErr) {
    return NextResponse.json({ error: rulesErr.message }, { status: 500 });
  }

  const tickStartedAt = new Date().toISOString();
  const results: ProcessResult[] = [];
  for (const r of rules ?? []) {
    try {
      results.push(await processAiRule(admin, r as RuleRow));
    } catch (err) {
      results.push({
        state: 'error',
        ruleId: r.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  // Aggregate token usage so the per-tick log reveals cache-hit rate
  // — the caching investment only pays off if cache_read_input_tokens
  // dominates total input across the tick.
  const usageTotals = results.reduce(
    (acc, r) => {
      const u = ('usage' in r ? r.usage : null) as AiUsage | null;
      if (!u) return acc;
      acc.input_tokens += u.input_tokens ?? 0;
      acc.output_tokens += u.output_tokens ?? 0;
      acc.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
      acc.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
      return acc;
    },
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  );

  return NextResponse.json({
    tickStartedAt,
    processed: results.length,
    fired: results.filter(r => r.state === 'fired').length,
    cooldown: results.filter(r => r.state === 'cooldown').length,
    no_match: results.filter(r => r.state === 'no_match').length,
    skipped: results.filter(r => r.state === 'skipped').length,
    errors: results.filter(r => r.state === 'error').length,
    usage: usageTotals,
  });
}

async function processAiRule(
  admin: SupabaseClient,
  rule: RuleRow,
): Promise<ProcessResult> {
  if (isCooldownActive(rule)) {
    return { state: 'cooldown', ruleId: rule.id };
  }

  // Validate the config has an outcome statement; reject loudly so
  // the rule list shows the issue rather than silently never firing.
  const cfg = rule.config as Record<string, unknown>;
  const outcome = typeof cfg?.outcome_statement === 'string' ? cfg.outcome_statement.trim() : '';
  if (!outcome) {
    return { state: 'skipped', ruleId: rule.id, reason: 'missing_outcome_statement' };
  }

  const buckets = resolveBuckets(rule);
  if (rule.rule_type === 'cross_data_ai' && buckets.length < 2) {
    return { state: 'skipped', ruleId: rule.id, reason: 'cross_data_needs_2_plus_buckets' };
  }

  const k = resolveKEvents(rule);
  const events = await gatherEvents(admin, rule, buckets, k);
  const trimmed = truncateToTokenBudget(events, AI_INPUT_TOKEN_BUDGET);

  const decision = await decideWithClaude(rule, trimmed);
  if (!decision.fire) {
    return { state: 'no_match', ruleId: rule.id, usage: decision.usage };
  }

  const { data: channelRows, error: chErr } = await admin
    .from('user_channels')
    .select('id, channel_type, handle, label, verified_at, active')
    .in('id', rule.channel_ids);
  if (chErr) {
    return { state: 'error', ruleId: rule.id, error: chErr.message };
  }

  const firedAtIso = new Date().toISOString();
  const payload = buildAiFirePayload(rule, decision, firedAtIso);
  const deliveryStatus: Record<string, DispatchOutcome> = {};

  for (const channelId of rule.channel_ids) {
    const row = (channelRows ?? []).find(c => c.id === channelId);
    if (!row) {
      deliveryStatus[channelId] = {
        ok: false,
        error: 'channel_not_found',
        suppressed_reason: 'channel_deleted_or_inaccessible',
      };
      continue;
    }
    if (!row.verified_at) {
      deliveryStatus[channelId] = {
        ok: false,
        error: 'channel_unverified',
        suppressed_reason: 'channel_unverified',
      };
      continue;
    }
    if (!row.active) {
      deliveryStatus[channelId] = {
        ok: false,
        error: 'channel_paused',
        suppressed_reason: 'channel_paused',
      };
      continue;
    }
    deliveryStatus[channelId] = await dispatchToChannel(row as VerifiedChannel, payload);
  }

  const { data: logRow, error: logErr } = await admin
    .from('user_notification_log')
    .insert({
      rule_id: rule.id,
      user_id: rule.user_id,
      fired_at: firedAtIso,
      channel_ids: rule.channel_ids,
      payload: {
        ...payload,
        events_considered: decision.eventsConsidered,
        usage: decision.usage,
      },
      delivery_status: deliveryStatus,
    })
    .select('id')
    .single();
  if (logErr) {
    console.error('[notif:cron-ai] log insert failed', logErr.message);
  }

  await admin
    .from('user_notification_rules')
    .update({ last_fired_at: firedAtIso, updated_at: firedAtIso })
    .eq('id', rule.id);

  return { state: 'fired', ruleId: rule.id, logId: logRow?.id ?? null, usage: decision.usage };
}
