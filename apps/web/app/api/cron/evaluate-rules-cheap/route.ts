import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  buildFirePayload,
  findSingleEventMatch,
  isCooldownActive,
  type RuleRow,
} from '@/lib/notifications/evaluator-cheap';
import {
  dispatchToChannel,
  type DispatchOutcome,
  type VerifiedChannel,
} from '@/lib/notifications/dispatch';

// /api/cron/evaluate-rules-cheap — runs every 15 minutes.
//
// PR 6 wires single_event only. PR 7 extends this same route with
// the multi_event branch. The expensive AI-evaluator (outcome_ai +
// cross_data_ai) lives in /api/cron/evaluate-rules-ai and runs at
// 1-h cadence — see PR 8.
//
// Cap on per-tick work: the route bails out if it processes more
// than MAX_RULES_PER_TICK. Railway's cron timeout is 30 s by default,
// and a slow evaluation pass on one rule shouldn't stall the queue.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_RULES_PER_TICK = 200;

type ProcessResult =
  | { state: 'fired'; ruleId: string; logId: string | null }
  | { state: 'cooldown'; ruleId: string }
  | { state: 'no_match'; ruleId: string }
  | { state: 'error'; ruleId: string; error: string };

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const admin = createServerSupabase();

  // Pull active single_event rules, oldest-evaluated first so a
  // rule that's been waiting since the last tick gets first crack.
  // multi_event rows are NULL-aware on last_fired_at — same ordering
  // works for both once PR 7 lands.
  const { data: rules, error: rulesErr } = await admin
    .from('user_notification_rules')
    .select(
      'id, user_id, name, rule_type, config, channel_ids, active, cooldown_minutes, last_fired_at, created_at',
    )
    .eq('active', true)
    .in('rule_type', ['single_event'])
    .order('last_fired_at', { ascending: true, nullsFirst: true })
    .limit(MAX_RULES_PER_TICK);

  if (rulesErr) {
    return NextResponse.json({ error: rulesErr.message }, { status: 500 });
  }

  const tickStartedAt = new Date().toISOString();
  const results: ProcessResult[] = [];
  for (const r of rules ?? []) {
    try {
      results.push(await processRule(admin, r as RuleRow));
    } catch (err) {
      results.push({
        state: 'error',
        ruleId: r.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  const summary = {
    tickStartedAt,
    processed: results.length,
    fired: results.filter(r => r.state === 'fired').length,
    cooldown: results.filter(r => r.state === 'cooldown').length,
    no_match: results.filter(r => r.state === 'no_match').length,
    errors: results.filter(r => r.state === 'error').length,
  };
  return NextResponse.json(summary);
}

async function processRule(
  admin: SupabaseClient,
  rule: RuleRow,
): Promise<ProcessResult> {
  if (isCooldownActive(rule)) {
    return { state: 'cooldown', ruleId: rule.id };
  }

  // Currently single_event only — multi_event lands in PR 7.
  if (rule.rule_type !== 'single_event') {
    return { state: 'no_match', ruleId: rule.id };
  }

  const match = await findSingleEventMatch(admin, rule);
  if (!match) {
    return { state: 'no_match', ruleId: rule.id };
  }

  // Resolve channel ids → verified, active rows. Anything that fails
  // the filter (revoked, paused, deleted) gets dropped from the
  // dispatch list but recorded in delivery_status with a reason.
  const { data: channelRows, error: chErr } = await admin
    .from('user_channels')
    .select('id, channel_type, handle, label, verified_at, active')
    .in('id', rule.channel_ids);

  if (chErr) {
    return { state: 'error', ruleId: rule.id, error: chErr.message };
  }

  const firedAtIso = new Date().toISOString();
  const payload = buildFirePayload(rule, match, firedAtIso);
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
        match_row: match.row,
      },
      delivery_status: deliveryStatus,
    })
    .select('id')
    .single();

  if (logErr) {
    // Log-write failures shouldn't suppress the user's email — it
    // already went out. Surface the error in the per-tick summary.
    console.error('[notif:cron] log insert failed', logErr.message);
  }

  await admin
    .from('user_notification_rules')
    .update({ last_fired_at: firedAtIso, updated_at: firedAtIso })
    .eq('id', rule.id);

  return { state: 'fired', ruleId: rule.id, logId: logRow?.id ?? null };
}
