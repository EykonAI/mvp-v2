/**
 * Ledger alert transitions (migration 141) — the evaluator behind the
 * monitor's "firing since", and the Discord channel's view of the ledger.
 *
 * Same discipline as mig 089's feed-health alerts (lib/monitoring/feed-health.ts):
 * one state row per open alert; a new alert posts once; an escalation posts
 * immediately; a crit that stays open re-posts every LEDGER_REALERT_HOURS;
 * recovery posts once and closes the loop. Every transition is a row in
 * ledger_alert_events, notified or not. Fail-soft throughout — a monitoring
 * bug must never cost the ledger anything, and an unreachable webhook is a
 * recorded transition with notified=false, not a lost one.
 *
 * ONLY the hourly cron calls this. Rendering the page must never call it:
 * displaying an alert must not advance its clock or post it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateAlerts, probeAlertInputs, type Alert } from '@/lib/admin/calibration-monitor';
import { postAlertWebhook } from '@/lib/monitoring/feed-health';

const REALERT_HOURS = Number(process.env.LEDGER_REALERT_HOURS ?? 24);
const PAGE = 'https://eykon.ai/admin/calibration-monitor';
const RANK = { crit: 2, warn: 1 } as const;

type Sev = 'warn' | 'crit';
type Transition = 'fired' | 'escalated' | 'de-escalated' | 're-alerted' | 'cleared';
interface StateRow { alert_id: string; severity: Sev; text: string; first_fired_at: string; last_notified_at: string | null }

export interface LedgerAlertReport {
  checked_at: string;
  open: number;
  fired: string[];
  escalated: string[];
  re_alerted: string[];
  cleared: string[];
  errors: string[];
}

function message(transition: Transition, a: Alert, prior?: StateRow, now?: Date): string {
  const tag = transition === 'cleared' ? 'RECOVERED' : transition === 're-alerted' ? `STILL ${a.severity.toUpperCase()}` : a.severity.toUpperCase();
  const head = `[${tag}] Calibration ledger · ${a.id}`;
  if (transition === 'cleared' && prior && now) {
    const hours = ((now.getTime() - Date.parse(prior.first_fired_at)) / 3_600_000).toFixed(1);
    return `${head} — clear after ${hours} h (fired ${prior.first_fired_at.slice(0, 16).replace('T', ' ')} UTC)\n${PAGE}`;
  }
  return `${head}\n${a.text}\nrule: ${a.rule}\n${PAGE}`;
}

export async function evaluateAndRecordLedgerAlerts(supabase: SupabaseClient, now: Date = new Date()): Promise<LedgerAlertReport> {
  const report: LedgerAlertReport = { checked_at: now.toISOString(), open: 0, fired: [], escalated: [], re_alerted: [], cleared: [], errors: [] };

  const inputs = await probeAlertInputs(supabase);
  if (inputs.health.error) report.errors.push(`health: ${inputs.health.error}`);
  const alerts = evaluateAlerts(inputs, now).filter((a): a is Alert & { severity: Sev } => a.severity === 'warn' || a.severity === 'crit');

  const { data: stateRows, error: stateErr } = await supabase
    .from('ledger_alert_state')
    .select('alert_id, severity, text, first_fired_at, last_notified_at');
  if (stateErr) {
    // Without state we cannot tell new from known — do nothing rather than spam.
    report.errors.push(`state: ${stateErr.message}`);
    return report;
  }
  const state = new Map((stateRows as StateRow[] | null ?? []).map((r) => [r.alert_id, r]));

  const record = async (a: Alert, transition: Transition, notified: boolean) => {
    const { error } = await supabase.from('ledger_alert_events').insert({ alert_id: a.id, transition, severity: a.severity, text: a.text, at: now.toISOString(), notified });
    if (error) report.errors.push(`event ${transition} ${a.id}: ${error.message}`);
  };
  const post = async (text: string): Promise<boolean> => {
    if (!process.env.NEWSJACK_ALERT_WEBHOOK) return false;
    try {
      await postAlertWebhook(text);
      return true;
    } catch {
      return false;
    }
  };

  for (const a of alerts) {
    const prior = state.get(a.id);
    if (!prior) {
      const notified = await post(message('fired', a));
      const { error } = await supabase.from('ledger_alert_state').upsert(
        { alert_id: a.id, severity: a.severity, text: a.text, rule: a.rule, first_fired_at: now.toISOString(), last_seen_at: now.toISOString(), last_notified_at: notified ? now.toISOString() : null },
        { onConflict: 'alert_id' },
      );
      if (error) report.errors.push(`state upsert ${a.id}: ${error.message}`);
      await record(a, 'fired', notified);
      report.fired.push(a.id);
      continue;
    }
    if (prior.severity !== a.severity) {
      const up = RANK[a.severity] > RANK[prior.severity];
      const notified = up ? await post(message('escalated', a)) : false;
      const { error } = await supabase
        .from('ledger_alert_state')
        .update({ severity: a.severity, text: a.text, rule: a.rule, last_seen_at: now.toISOString(), ...(notified ? { last_notified_at: now.toISOString() } : {}) })
        .eq('alert_id', a.id);
      if (error) report.errors.push(`state update ${a.id}: ${error.message}`);
      await record(a, up ? 'escalated' : 'de-escalated', notified);
      if (up) report.escalated.push(a.id);
      continue;
    }
    const dueAgain = a.severity === 'crit' && (prior.last_notified_at === null || now.getTime() - Date.parse(prior.last_notified_at) >= REALERT_HOURS * 3_600_000);
    const notified = dueAgain ? await post(message('re-alerted', a)) : false;
    const { error } = await supabase
      .from('ledger_alert_state')
      .update({ text: a.text, last_seen_at: now.toISOString(), ...(notified ? { last_notified_at: now.toISOString() } : {}) })
      .eq('alert_id', a.id);
    if (error) report.errors.push(`state touch ${a.id}: ${error.message}`);
    if (dueAgain) {
      await record(a, 're-alerted', notified);
      report.re_alerted.push(a.id);
    }
  }

  // Recovery: say it once, close the loop, drop the state row.
  const open = new Set(alerts.map((a) => a.id));
  for (const [id, prior] of state) {
    if (open.has(id)) continue;
    const ghost: Alert = { id, severity: prior.severity, text: prior.text, rule: '', evaluated_at: now.toISOString() };
    const notified = await post(message('cleared', ghost, prior, now));
    const { error } = await supabase.from('ledger_alert_state').delete().eq('alert_id', id);
    if (error) report.errors.push(`state clear ${id}: ${error.message}`);
    await record(ghost, 'cleared', notified);
    report.cleared.push(id);
  }

  report.open = alerts.length;
  return report;
}
