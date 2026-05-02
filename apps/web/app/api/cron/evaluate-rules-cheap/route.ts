import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  buildFirePayload,
  buildMultiEventFirePayload,
  findMultiEventMatch,
  findSingleEventMatch,
  isCooldownActive,
  type MatchedEvent,
  type MultiEventMatchResult,
  type RuleRow,
} from '@/lib/notifications/evaluator-cheap';
import { dispatchWithCap } from '@/lib/notifications/dispatch-with-cap';
import { findRecentFireCount, PER_RULE_PER_DAY_FIRE_LIMIT } from '@/lib/notifications/cap';
import type { Tier } from '@/lib/auth/session';

// /api/cron/evaluate-rules-cheap — runs every 15 minutes.
//
// Handles single_event and multi_event rules. The expensive AI
// evaluator (outcome_ai + cross_data_ai) lives in
// /api/cron/evaluate-rules-ai and runs at 1-h cadence — see PR 8.
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
  | { state: 'rate_limited'; ruleId: string }
  | { state: 'error'; ruleId: string; error: string };

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const admin = createServerSupabase();

  // Pull active single_event + multi_event rules, oldest-evaluated
  // first so a rule that's been waiting since the last tick gets
  // first crack. NULL last_fired_at sorts before any timestamp.
  const { data: rules, error: rulesErr } = await admin
    .from('user_notification_rules')
    .select(
      'id, user_id, name, rule_type, config, channel_ids, active, cooldown_minutes, last_fired_at, created_at',
    )
    .eq('active', true)
    .in('rule_type', ['single_event', 'multi_event'])
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
    rate_limited: results.filter(r => r.state === 'rate_limited').length,
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

  // Per-rule per-day rate limit (brief §3.6) — defence-in-depth
  // against runaway misconfigured rules. Applied BEFORE we even
  // query the feed: if a rule has fired ≥20 times in 24 h, we
  // short-circuit without writing a log row (the limit caps fires,
  // not just dispatches).
  const recentFires = await findRecentFireCount(admin, rule.id, 24);
  if (recentFires >= PER_RULE_PER_DAY_FIRE_LIMIT) {
    return { state: 'rate_limited', ruleId: rule.id };
  }

  let firePayloadInput:
    | { kind: 'single'; match: MatchedEvent }
    | { kind: 'multi'; result: MultiEventMatchResult }
    | null = null;
  if (rule.rule_type === 'single_event') {
    const match = await findSingleEventMatch(admin, rule);
    if (match) firePayloadInput = { kind: 'single', match };
  } else if (rule.rule_type === 'multi_event') {
    const result = await findMultiEventMatch(admin, rule);
    if (result) firePayloadInput = { kind: 'multi', result };
  }
  if (!firePayloadInput) {
    return { state: 'no_match', ruleId: rule.id };
  }

  // Resolve channel ids → verified, active rows. dispatchWithCap
  // does the row-level filter (drops missing/unverified/paused with
  // discriminated suppressed_reason) and applies the SMS+WhatsApp
  // monthly cap (Pro 50, Desk 200, Enterprise 1000) with the soft-
  // warn at 80 % / hard stop at 150 % semantics.
  const { data: channelRows, error: chErr } = await admin
    .from('user_channels')
    .select('id, channel_type, handle, label, verified_at, active')
    .in('id', rule.channel_ids);

  if (chErr) {
    return { state: 'error', ruleId: rule.id, error: chErr.message };
  }

  const firedAtIso = new Date().toISOString();
  const payload =
    firePayloadInput.kind === 'single'
      ? buildFirePayload(rule, firePayloadInput.match, firedAtIso)
      : buildMultiEventFirePayload(rule, firePayloadInput.result, firedAtIso);

  const userTier = await getUserTier(admin, rule.user_id);
  const userEmail = await getUserEmail(admin, rule.user_id);

  const dispatchSummary = await dispatchWithCap({
    supabase: admin,
    userId: rule.user_id,
    userTier,
    userEmail,
    rule: { channel_ids: rule.channel_ids },
    payload,
    channelRows: (channelRows ?? []) as Array<{
      id: string;
      channel_type: 'email' | 'sms' | 'whatsapp';
      handle: string;
      label: string | null;
      verified_at: string | null;
      active: boolean;
    }>,
  });
  const deliveryStatus = dispatchSummary.delivery_status;

  const matchExtras =
    firePayloadInput.kind === 'single'
      ? { match_row: firePayloadInput.match.row }
      : {
          match_rows: firePayloadInput.result.matches.map(m => m.row),
          matched_at: firePayloadInput.result.matchedAtIso,
        };
  const { data: logRow, error: logErr } = await admin
    .from('user_notification_log')
    .insert({
      rule_id: rule.id,
      user_id: rule.user_id,
      fired_at: firedAtIso,
      channel_ids: rule.channel_ids,
      payload: {
        ...payload,
        ...matchExtras,
        cap_state: {
          monthly_sms_wa_count: dispatchSummary.monthly_sms_wa_count,
          soft_warn_triggered: dispatchSummary.soft_warn_triggered,
          warning_email_sent: dispatchSummary.warning_email_sent,
        },
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

// ─── User lookups (service-role only) ────────────────────────────

async function getUserTier(admin: SupabaseClient, userId: string): Promise<Tier> {
  const { data } = await admin
    .from('user_profiles')
    .select('tier')
    .eq('id', userId)
    .maybeSingle();
  const tier = data?.tier as Tier | undefined;
  return tier ?? 'pro';
}

async function getUserEmail(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin
    .from('user_profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  return data?.email ?? null;
}
