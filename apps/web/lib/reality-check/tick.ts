import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CLASSIFIER_VERSION, METHOD, classifyComplex, daysBetween, funnelOf, windowsFor,
  type ComplexInputs, type Funnel, type TickWindows, type VerdictRow,
} from './classify';
import { issueRefineryClaims, SOURCE, type ClaimsResult } from './claims';
import { recordIssuanceRun } from '@/lib/predictions/run-records';

/**
 * Reality Check — the weekly refinery tick (PR-5, D-6, D-14).
 *
 * Runs from an EXISTING cron route (app/api/cron/detect-nightlights-
 * significance, Railway, daily ~10:22 UTC — after the Black Marble worker
 * ~09:44, the census refresh at :50 and the pg_cron night-lights judgement at
 * 10:05). No new Railway service. The read is one RPC (~50 ms); the
 * classifier is ./classify.ts; the KS test is lib/intel/ks.ts.
 *
 * WHEN IT PUBLISHES (the rolling rule, D-6):
 *   data clock   = the newest USABLE Black Marble refinery night in the census
 *                  (sensor_usable_nights) — never the wall clock.
 *   a new tick   when there is none yet, or the clock has advanced >= 7 nights
 *                past the newest complete tick: window = the 15 nights ending
 *                on the clock, baseline = the 31 before.
 *   superseding  when the clock has not advanced 7 nights but the usable
 *                nights inside the newest tick's range have changed since it
 *                ran (a late night): the same windows, recomputed, with
 *                supersedes_run_id. Both stay; PR-6 adds immutability.
 *   otherwise    no tick is written; the response and a run record say why.
 * A run row is written before the verdicts and completed after them; a crash
 * leaves 'running', which the next call marks failed ('abandoned'). Every
 * call also leaves an issuance_runs row (source 'refinery-rc'): the issuer's
 * on an issuing or alternate tick, recordTickRun()'s otherwise.
 *
 * The population is the complex registry (mig 160 + 169: site_type =
 * 'refinery' only). A complex still holding a re-typed member means the
 * registry has not been rebuilt since a re-type: the tick refuses rather than
 * publish the wrong population.
 */

export type TickAction = 'published' | 'superseding' | 'skipped' | 'refused' | 'failed';

/** One row of reality_check_publish_tick()'s report (PR-6, mig 171). */
export interface PublishedIssue {
  run_id: number;
  tick: string;
  revision: number;
  content_hash: string;
}

export interface TickResult {
  action: TickAction;
  reason: string;
  run_id: number | null;
  supersedes_run_id: number | null;
  data_clock_night: string | null;
  windows: TickWindows | null;
  funnel: Funnel | null;
  claims: ClaimsResult | null;
  /** PR-6: the ticks this call turned into frozen, citable issues. */
  issues: PublishedIssue[] | null;
  issue_error: string | null;
  duration_ms: number;
  error: string | null;
}

type Db = SupabaseClient;
const ABANDON_AFTER_MS = 30 * 60_000;
const NEW_TICK_NIGHTS = 7;

function iso(v: unknown): string {
  return String(v).slice(0, 10);
}

async function usableNights(db: Db, sensor: 'blackmarble' | 'firms', from: string, to: string): Promise<string[]> {
  const { data, error } = await db
    .from('sensor_usable_nights')
    .select('night')
    .eq('sensor', sensor)
    .eq('facility_type', 'refinery')
    .gte('night', from)
    .lte('night', to)
    .order('night', { ascending: true });
  if (error) throw new Error(`${sensor} usable nights: ${error.message}`);
  return ((data ?? []) as Array<{ night: string }>).map((r) => iso(r.night));
}

async function dataClock(db: Db): Promise<string | null> {
  const { data, error } = await db
    .from('sensor_usable_nights')
    .select('night')
    .eq('sensor', 'blackmarble')
    .eq('facility_type', 'refinery')
    .order('night', { ascending: false })
    .limit(1);
  if (error) throw new Error(`data clock: ${error.message}`);
  const v = (data ?? [])[0] as { night?: string } | undefined;
  return v?.night ? iso(v.night) : null;
}

interface LastRun {
  id: number; data_clock_night: string; baseline_start: string; window_end: string;
  bm_nights_used: string[] | null; firms_days_used: string[] | null;
}

async function newestCompleteRun(db: Db): Promise<LastRun | null> {
  const { data, error } = await db
    .from('reality_check_runs')
    .select('id, data_clock_night, baseline_start, window_end, bm_nights_used, firms_days_used')
    .eq('asset_class', 'refinery')
    .eq('status', 'complete')
    .order('data_clock_night', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(`last run: ${error.message}`);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    data_clock_night: iso(r.data_clock_night),
    baseline_start: iso(r.baseline_start),
    window_end: iso(r.window_end),
    bm_nights_used: Array.isArray(r.bm_nights_used) ? (r.bm_nights_used as unknown[]).map(iso) : null,
    firms_days_used: Array.isArray(r.firms_days_used) ? (r.firms_days_used as unknown[]).map(iso) : null,
  };
}

const same = (a: string[] | null, b: string[]) => a !== null && a.length === b.length && a.every((x, i) => x === b[i]);

export type Plan =
  | { kind: 'new'; clock: string; supersedes: null; reason: string }
  | { kind: 'supersede'; clock: string; supersedes: number; reason: string }
  | { kind: 'skip'; reason: string };

/** The rolling rule, pure: what this call should do given the clock and the newest tick. */
export function planTick(args: {
  clock: string | null;
  last: LastRun | null;
  bmNow: string[] | null;     // usable BM nights over the last tick's range, now
  firmsNow: string[] | null;  // usable FIRMS days over the last tick's range, now
}): Plan {
  const { clock, last, bmNow, firmsNow } = args;
  if (!clock) return { kind: 'skip', reason: 'no usable Black Marble refinery night in the census — no data clock' };
  if (!last) return { kind: 'new', clock, supersedes: null, reason: `first tick: data clock ${clock}` };
  const advanced = daysBetween(last.data_clock_night, clock);
  if (advanced >= NEW_TICK_NIGHTS) {
    return { kind: 'new', clock, supersedes: null, reason: `data clock ${clock} is ${advanced} nights past the last tick (${last.data_clock_night})` };
  }
  if (advanced < 0) {
    return { kind: 'skip', reason: `data clock ${clock} is behind the last tick (${last.data_clock_night}) — a night stopped being usable; nothing published` };
  }
  if (bmNow && firmsNow && (!same(last.bm_nights_used, bmNow) || !same(last.firms_days_used, firmsNow))) {
    return {
      kind: 'supersede', clock: last.data_clock_night, supersedes: last.id,
      reason: `late night: the usable nights inside tick ${last.id}'s range (${last.baseline_start}..${last.window_end}) changed since it ran — superseding tick`,
    };
  }
  return { kind: 'skip', reason: `data clock ${clock} is ${advanced} night(s) past the last tick (${last.data_clock_night}); a new tick needs ${NEW_TICK_NIGHTS}; no late night` };
}

export async function runRefineryRealityCheck(db: Db, now: Date = new Date()): Promise<TickResult> {
  const t0 = Date.now();
  const out: TickResult = {
    action: 'skipped', reason: '', run_id: null, supersedes_run_id: null, data_clock_night: null,
    windows: null, funnel: null, claims: null, issues: null, issue_error: null,
    duration_ms: 0, error: null,
  };
  let runId: number | null = null;
  try {
    // a run a crashed call left 'running' can never complete: say so
    const { error: abErr } = await db
      .from('reality_check_runs')
      .update({ status: 'failed', completed_at: now.toISOString(), error: 'abandoned: the tick did not complete (process ended before the run was closed)' })
      .eq('asset_class', 'refinery')
      .eq('status', 'running')
      .lt('started_at', new Date(now.getTime() - ABANDON_AFTER_MS).toISOString());
    if (abErr) throw new Error(`abandon sweep: ${abErr.message}`);

    const clock = await dataClock(db);
    const last = await newestCompleteRun(db);
    const bmNow = last ? await usableNights(db, 'blackmarble', last.baseline_start, last.window_end) : null;
    const firmsNow = last ? await usableNights(db, 'firms', last.baseline_start, last.window_end) : null;
    const plan = planTick({ clock, last, bmNow, firmsNow });
    out.reason = plan.reason;
    if (plan.kind === 'skip') return out;

    const w = windowsFor(plan.clock);
    out.data_clock_night = w.data_clock_night;
    out.windows = w;
    out.supersedes_run_id = plan.supersedes;

    const [bmUsed, firmsUsed] = await Promise.all([
      usableNights(db, 'blackmarble', w.baseline_start, w.window_end),
      usableNights(db, 'firms', w.baseline_start, w.window_end),
    ]);

    // One row per complex (~300). Paged and ordered anyway: PostgREST caps a
    // response at its max-rows, and a silently truncated population is a
    // wrong board, not a slow one (#506).
    const rows: ComplexInputs[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error: inErr } = await db
        .rpc('reality_check_tick_inputs', { p_from: w.baseline_start, p_to: w.window_end })
        .order('cluster_key', { ascending: true })
        .range(from, from + 999);
      if (inErr) throw new Error(`tick inputs: ${inErr.message}`);
      const page = (data ?? []) as ComplexInputs[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    const inputs = rows.map((r) => ({
      ...r,
      light_nights: (r.light_nights ?? []).map(iso),
      heat_days: (r.heat_days ?? []).map(iso),
    }));
    const stale = inputs.filter((r) => Number(r.non_refinery_members) > 0);
    if (stale.length > 0) {
      out.action = 'refused';
      out.reason = `${stale.length} complex(es) still hold a site that is not site_type 'refinery' (${stale.slice(0, 3).map((s) => s.cluster_key).join(', ')}) — the registry has not been rebuilt since a re-type; nothing published`;
      return out;
    }
    if (inputs.length === 0) {
      out.action = 'refused';
      out.reason = 'no active refinery complex — the registry is empty; nothing published';
      return out;
    }

    const verdicts: VerdictRow[] = inputs.map((r) => classifyComplex(r, w));
    out.funnel = funnelOf(verdicts);

    // ── write: run (running) → verdicts → complete ─────────────────────
    const { data: run, error: runErr } = await db
      .from('reality_check_runs')
      .insert({
        asset_class: 'refinery',
        status: 'running',
        data_clock_night: w.data_clock_night,
        window_start: w.window_start,
        window_end: w.window_end,
        baseline_start: w.baseline_start,
        baseline_end: w.baseline_end,
        window_nights: METHOD.window_nights,
        baseline_nights: METHOD.baseline_nights,
        statistic: METHOD.statistic,
        light_column: METHOD.light_column,
        robustness_column: METHOD.robustness_column,
        robustness_min_px_hq: METHOD.robustness_min_px_hq,
        clear_night_rule: METHOD.clear_night_rule,
        census_usable_ratio: METHOD.census_usable_ratio,
        light_down_ratio: METHOD.light_down_ratio,
        heat_down_ratio: METHOD.heat_down_ratio,
        heat_observable_floor: METHOD.heat_observable_floor,
        heat_rate_rule: METHOD.heat_rate_rule,
        min_baseline_nights: METHOD.min_baseline_nights,
        min_window_nights: METHOD.min_window_nights,
        ks_min_baseline_nights: METHOD.ks_min_baseline_nights,
        ks_alpha: METHOD.ks_alpha,
        complex_rule: METHOD.complex_rule,
        complex_linkage_m: METHOD.complex_linkage_m,
        complex_rematch_m: METHOD.complex_rematch_m,
        ks_split_rule: METHOD.ks_split_rule,
        supersedes_run_id: plan.supersedes,
        classifier_version: CLASSIFIER_VERSION,
        complexes_in_scope: verdicts.length,
        bm_nights_used: bmUsed,
        firms_days_used: firmsUsed,
      })
      .select('id')
      .single();
    if (runErr || !run) throw new Error(`run insert: ${runErr?.message ?? 'no row'}`);
    runId = Number((run as { id: number }).id);
    out.run_id = runId;

    for (let i = 0; i < verdicts.length; i += 200) {
      const chunk = verdicts.slice(i, i + 200).map((v) => ({ run_id: runId, ...v }));
      const { error } = await db.from('reality_check_site_verdicts').insert(chunk);
      if (error) throw new Error(`verdict insert (rows ${i}–${i + chunk.length - 1}): ${error.message}`);
    }

    const { error: doneErr } = await db
      .from('reality_check_runs')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        verdicts_written: verdicts.length,
        duration_ms: Date.now() - t0,
      })
      .eq('id', runId);
    if (doneErr) throw new Error(`run complete: ${doneErr.message}`);
    out.action = plan.kind === 'supersede' ? 'superseding' : 'published';

    // ── claims: new ticks only, alternate ticks (./claims.ts) ───────────
    if (plan.kind === 'new') {
      const names = new Map(inputs.map((r) => [r.cluster_key, r.member_names ?? r.members]));
      out.claims = await issueRefineryClaims(db, { runId, windows: w, verdicts, names }, now);
      // Mark the tick as an issuing tick only when the issuer finished (or
      // wrote claims). An issuer that FAILED before writing anything leaves
      // claims_issued NULL: recording 0 would state "issuing tick, nothing to
      // claim" — false — and would push the next issuing tick 14 nights out,
      // losing a whole cycle of claims to one transient error. With NULL the
      // next new tick (+7) issues; the failure itself is in the route's
      // errors and in issuance_runs.
      if (out.claims.issuing && (out.claims.error === null || out.claims.issued > 0)) {
        const { error } = await db.from('reality_check_runs').update({ claims_issued: out.claims.issued }).eq('id', runId);
        if (error) out.claims.error = [out.claims.error, `claims_issued: ${error.message}`].filter(Boolean).join(' · ');
      }
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    out.action = 'failed';
    if (runId !== null) {
      await db
        .from('reality_check_runs')
        .update({ status: 'failed', completed_at: new Date().toISOString(), error: out.error.slice(0, 2000) })
        .eq('id', runId)
        .eq('status', 'running');
    }
  } finally {
    // PR-6 (mig 171): publication is what FREEZES a tick — from the moment an
    // issue row exists, the run, its verdicts and the issue refuse UPDATE and
    // DELETE for every role. So it runs last, after the verdicts are written
    // and after the issuer has set claims_issued, and it runs in `finally`
    // for the same reason the run record does: on a skipped day it publishes
    // any complete tick that failed to publish earlier, which is what makes
    // a transient failure self-healing rather than permanent.
    await publishIssues(db, out);
    out.duration_ms = Date.now() - t0;
    // In `finally`, not after it: the skip and refuse paths return from
    // inside the try, and they are exactly the days that must leave a record.
    await recordTickRun(db, out);
  }
  return out;
}

/**
 * Publish every complete, unpublished tick as a frozen reality_check_issues
 * row (mig 171). Additive: a failure here is reported and never changes the
 * tick — the verdicts are already written, and the next cron run retries.
 */
export async function publishIssues(db: Db, out: TickResult): Promise<void> {
  try {
    const { data, error } = await db.rpc('reality_check_publish_tick');
    if (error) throw new Error(error.message);
    const report = (data ?? {}) as { published?: PublishedIssue[] };
    out.issues = Array.isArray(report.published) ? report.published : [];
  } catch (e) {
    out.issue_error = e instanceof Error ? e.message : String(e);
  }
}

/**
 * RUN RECORD (R-4; the mig-138 rule "a row iff the tick ran"). A tick that
 * reaches the issuer is recorded by it (claims.ts, source 'refinery-rc'). Every
 * other outcome — skipped (most days), superseding, refused, or failed,
 * including a failure before any reality_check_runs row exists — writes one
 * issuance_runs row here, so the ledger can tell "ran and had nothing to
 * publish" from "never ran", and a refused or failed tick carries its error
 * into the admin monitor's issuance-error alert instead of living only in a
 * Railway log. Additive: a failure to write it never changes the tick.
 */
export async function recordTickRun(db: Db, out: TickResult): Promise<string | null> {
  if (out.claims !== null) return null;
  const why = (out.action === 'failed' ? out.error : out.reason) ?? '';
  return recordIssuanceRun(db as unknown as Parameters<typeof recordIssuanceRun>[0], {
    source: SOURCE,
    issued: 0,
    already_present: null,
    declined: { [`no issuing tick — tick ${out.action}: ${why}`.slice(0, 500)]: 1 },
    error: out.action === 'failed' || out.action === 'refused' ? `reality-check tick ${out.action}: ${why}`.slice(0, 2000) : null,
  });
}
