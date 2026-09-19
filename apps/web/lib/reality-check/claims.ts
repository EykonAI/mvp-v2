import type { SupabaseClient } from '@supabase/supabase-js';
import { computePredictionHash } from '@/lib/predictions/hash';
import { recordIssuanceRun } from '@/lib/predictions/run-records';
import { addDays, daysBetween, type TickWindows, type VerdictRow } from './classify';

/**
 * Reality Check — the refinery-rc claim issuer (PR-5, build prompt §3.5, D-7).
 *
 * Every claim type issues from the first tick, near-certain included, and
 * every family counts in the machine-track headline (founder, 18–19 Sep):
 *
 *   rc_heat_dark_persists  every thermally dark complex (REFUTED or LEAD) —
 *                          over the 14 FIRMS days after the FIRMS clock, the
 *                          heat rate stays below 0.60 × the baseline rate.
 *   rc_site_stays_lit      every REFUTED complex — over the 14 Black Marble
 *                          nights after the tick's data clock, the median
 *                          clear-night radiance stays >= 0.60 × baseline.
 *   rc_lead_light_persists every LEAD complex — the same median stays below.
 *   rc_refutation_holds    every REFUTED complex — not a LEAD in either of
 *                          the next two published ticks (near-certain). A
 *                          tick counts only if a LEAD was possible there
 *                          (non-VOID, >= 12 baseline nights); none → VOID.
 *
 * NO SELECTION. Which complexes get a claim is fixed by the tick's verdicts
 * (nights up to the data clock only); the number on the claim is the family's
 * walk-forward record, p = (k + 20 × 0.5)/(n + 20) (mig-149 shrinkage, read
 * from refinery_rc_walkforward(), mig 169), frozen with k and n. Nothing in a
 * claim's window can reach either. What the window already held at issue is
 * recorded on the claim, not hidden (window_nights_on_disk_at_issue).
 *
 * NO OVERLAP. Windows are 14 nights (two ticks) and claims issue on
 * ALTERNATE ticks: a tick issues only when its data clock is >= 14 nights past
 * the last issuing tick's (reality_check_runs.claims_issued marks issuing
 * ticks), and a superseding tick never issues. Each candidate is also checked
 * against the family's existing claims on the complex, so no two claims of
 * one family on one complex share a night even when ticks are irregular. The
 * one-claim-per-observable trigger (mig 150) is the backstop.
 *
 * A SUSPENDED family (negative split-half skill in both halves at >= 90
 * judged, never on an undefined skill) issues nothing, with the reason logged.
 */

export const FAMILIES = [
  'rc_heat_dark_persists',
  'rc_site_stays_lit',
  'rc_lead_light_persists',
  'rc_refutation_holds',
] as const;
export type Family = (typeof FAMILIES)[number];

export const SOURCE = 'refinery-rc';
export const CLAIM_DAYS = 14;
export const ISSUE_EVERY_NIGHTS = 14;
export const ALPHA = 20;

export interface MonitorFamily { judged: number; k: number; status: string; reason?: string; p_next?: number }
export type Monitor = { families: Record<string, MonitorFamily>; rule?: string };

export interface ClaimsResult {
  issuing: boolean;
  reason: string;
  issued: number;
  by_family: Record<string, number>;
  declined: Record<string, number>;
  error: string | null;
}

/** p = (k + α·0.5)/(n + α), 4 decimals. At n = 0 it is 0.5 — the honest start of a record. */
export function shrunkRate(k: number, n: number, alpha = ALPHA): number {
  return Math.round(((k + alpha * 0.5) / (n + alpha)) * 10000) / 10000;
}

/** Alternate ticks: the last issuing tick's clock + 14 nights, or now if there was none. */
export function isIssuingTick(clock: string, lastIssuingClock: string | null): boolean {
  return lastIssuingClock === null || daysBetween(lastIssuingClock, clock) >= ISSUE_EVERY_NIGHTS;
}

export function observable(family: Family, key: string, start: string, end: string): string {
  return `${SOURCE}:${family}:${key}:${start}..${end}`;
}

export interface Candidate {
  family: Family;
  row: VerdictRow;
  window_start: string;
  window_end: string;
}

/** Which claims a tick's verdicts call for (§3.5). Pure. */
export function candidatesFor(verdicts: VerdictRow[], w: TickWindows, firmsClock: string): Candidate[] {
  const out: Candidate[] = [];
  const lightStart = addDays(w.data_clock_night, 1);
  const lightEnd = addDays(w.data_clock_night, CLAIM_DAYS);
  const heatStart = addDays(firmsClock, 1);
  const heatEnd = addDays(firmsClock, CLAIM_DAYS);
  for (const r of verdicts) {
    if (r.verdict === 'REFUTED' || r.verdict === 'LEAD') {
      out.push({ family: 'rc_heat_dark_persists', row: r, window_start: heatStart, window_end: heatEnd });
    }
    if (r.verdict === 'REFUTED') {
      out.push({ family: 'rc_site_stays_lit', row: r, window_start: lightStart, window_end: lightEnd });
      out.push({ family: 'rc_refutation_holds', row: r, window_start: lightStart, window_end: lightEnd });
    }
    if (r.verdict === 'LEAD') {
      out.push({ family: 'rc_lead_light_persists', row: r, window_start: lightStart, window_end: lightEnd });
    }
  }
  return out;
}

function fmt(v: number | null): string {
  return v === null ? '—' : String(Math.round(v * 100) / 100);
}

export function statementFor(c: Candidate, label: string, w: TickWindows): string {
  const r = c.row;
  const who = `${label} (${r.cluster_key})`;
  const base = `${w.baseline_start}–${w.baseline_end}`;
  switch (c.family) {
    case 'rc_heat_dark_persists':
      return `${who}, thermally dark on the Reality Check tick of ${w.data_clock_night}: over the 14 FIRMS days ${c.window_start}–${c.window_end}, its heat rate (days with a detection ÷ days observed) stays below 0.60 × its baseline rate of ${r.baseline_heat_days}/${r.baseline_firms_days} days (${base}). VOID if fewer than 12 of the 14 days are observed.`;
    case 'rc_site_stays_lit':
      return `${who}, refuted on the Reality Check tick of ${w.data_clock_night}: over the 14 Black Marble nights ${c.window_start}–${c.window_end}, its median clear-night radiance stays at or above 0.60 × its baseline median of ${fmt(r.baseline_median)} (${base}). VOID with fewer than 3 usable clear nights.`;
    case 'rc_lead_light_persists':
      return `${who}, a lead on the Reality Check tick of ${w.data_clock_night}: over the 14 Black Marble nights ${c.window_start}–${c.window_end}, its median clear-night radiance stays below 0.60 × its baseline median of ${fmt(r.baseline_median)} (${base}). VOID with fewer than 3 usable clear nights.`;
    case 'rc_refutation_holds':
      return `${who}, refuted on the Reality Check tick of ${w.data_clock_night}: it is not a dual-confirmed lead in either of the next two Reality Check ticks. VOID unless at least one of those ticks could have called it a lead (a non-VOID verdict on >= 12 baseline nights, the stability test's floor).`;
  }
}

export function buildClaimRow(args: {
  c: Candidate; label: string; memberNames: string[]; w: TickWindows; runId: number;
  fam: MonitorFamily; firmsClock: string; nightsOnDisk: number | null; now: Date;
}): Record<string, unknown> {
  const { c, label, memberNames, w, runId, fam, firmsClock, nightsOnDisk, now } = args;
  const r = c.row;
  const p = shrunkRate(fam.k, fam.judged);
  const statement = statementFor(c, label, w);
  const targetObservable = observable(c.family, r.cluster_key, c.window_start, c.window_end);
  // Judgeable the day after the window closes; the resolver DEFERS until the
  // instrument has finalised it. Never before issue.
  const nominal = new Date(`${addDays(c.window_end, 1)}T00:00:00.000Z`);
  const resolvesAt = nominal.getTime() > now.getTime() ? nominal : new Date(now.getTime() + 3_600_000);
  const hash = computePredictionHash({ statement, targetObservable, resolvesAt, issuedAt: now, predictedMean: p });
  const light = c.family === 'rc_site_stays_lit' || c.family === 'rc_lead_light_persists';
  return {
    feature: c.family,
    context: {
      // Read by the resolver (refinery_rc_resolution, mig 170). Never parse the observable (#465).
      family: c.family,
      cluster_key: r.cluster_key,
      members: r.members,                      // the population the claim is about, frozen
      member_names: memberNames,
      window_start: c.window_start,
      window_end: c.window_end,
      window_instrument: c.family === 'rc_heat_dark_persists' ? 'firms'
        : c.family === 'rc_refutation_holds' ? 'reality_check_ticks' : 'blackmarble',
      tick_run_id: runId,
      tick_data_clock: w.data_clock_night,
      tick_window: `${w.window_start}..${w.window_end}`,
      tick_baseline: `${w.baseline_start}..${w.baseline_end}`,
      verdict_at_issue: r.verdict,
      robust_to_retrieval: r.robustness_verdict === r.verdict,
      baseline_median: light ? r.baseline_median : undefined,
      window_median_at_tick: light ? r.window_median : undefined,
      baseline_heat_days: r.baseline_heat_days,
      baseline_firms_days: r.baseline_firms_days,
      threshold_ratio: 0.6,
      firms_clock_at_issue: c.family === 'rc_heat_dark_persists' ? firmsClock : undefined,
      // How many of the window's nights already held a row for a member when
      // this claim was issued. Recorded so a reader can check it, not trust it:
      // nothing in the window feeds the verdict or the number.
      window_nights_on_disk_at_issue: nightsOnDisk,
      forecast_basis: fam.judged === 0
        ? 'flat_prior_no_judged_claims_yet'
        : 'walk_forward_family_rate_shrunk_to_0.5',
      forecast_k: fam.k,
      forecast_n: fam.judged,
      forecast_alpha: ALPHA,
      family_status_at_issue: fam.status,
      selection_rule: 'every complex the tick calls for (§3.5) · alternate ticks · no overlapping window per family and complex',
      note: 'Instruments observe heat and light, not intent: a planned turnaround and an unplanned outage look identical. Refinery recall not measured.',
    },
    predicted_distribution: { mean: p, type: 'point' },
    target_observable: targetObservable,
    target_window_hours: CLAIM_DAYS * 24,
    issued_at: now.toISOString(),
    resolves_at: resolvesAt.toISOString(),
    persona: 'analyst',
    statement,
    source: SOURCE,
    track: 'machine',
    hash,
  };
}

type Db = SupabaseClient;

async function newestIssuingClock(db: Db): Promise<string | null> {
  const { data, error } = await db
    .from('reality_check_runs')
    .select('data_clock_night')
    .eq('asset_class', 'refinery')
    .eq('status', 'complete')
    .not('claims_issued', 'is', null)
    .order('data_clock_night', { ascending: false })
    .limit(1);
  if (error) throw new Error(`issuing-tick read: ${error.message}`);
  const v = (data ?? [])[0] as { data_clock_night?: string } | undefined;
  return v?.data_clock_night ? String(v.data_clock_night).slice(0, 10) : null;
}

async function firmsDataClock(db: Db): Promise<string | null> {
  const { data, error } = await db
    .from('firms_facility_observations')
    .select('period')
    .eq('facility_type', 'refinery')
    .order('period', { ascending: false })
    .limit(1);
  if (error) throw new Error(`FIRMS clock read: ${error.message}`);
  const v = (data ?? [])[0] as { period?: string } | undefined;
  return v?.period ? String(v.period).slice(0, 10) : null;
}

/** Existing refinery-rc claims whose window could touch a new one (paged, ordered — #506). */
async function recentClaims(db: Db, since: Date): Promise<Array<{ feature: string; public_id: string; context: Record<string, unknown> }>> {
  const out: Array<{ feature: string; public_id: string; context: Record<string, unknown> }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('predictions_register')
      .select('id, feature, public_id, context')
      .eq('source', SOURCE)
      .gte('issued_at', since.toISOString())
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`register read: ${error.message}`);
    const rows = (data ?? []) as Array<{ feature: string; public_id: string; context: Record<string, unknown> }>;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Nights in [start, end] holding any Black Marble row for the members, per complex. */
async function nightsOnDisk(db: Db, members: Map<string, string[]>, start: string, end: string): Promise<Map<string, number>> {
  const ids = [...new Set([...members.values()].flat())];
  const byFacility = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('blackmarble_facility_radiance')
        .select('facility_id, period')
        .eq('facility_type', 'refinery')
        .in('facility_id', chunk)
        .gte('period', start)
        .lte('period', end)
        .order('facility_id', { ascending: true })
        .order('period', { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`window rows read: ${error.message}`);
      const rows = (data ?? []) as Array<{ facility_id: string; period: string }>;
      for (const r of rows) {
        const s = byFacility.get(r.facility_id) ?? new Set<string>();
        s.add(String(r.period).slice(0, 10));
        byFacility.set(r.facility_id, s);
      }
      if (rows.length < 1000) break;
    }
  }
  const out = new Map<string, number>();
  for (const [key, mem] of members) {
    const nights = new Set<string>();
    for (const f of mem) for (const n of byFacility.get(f) ?? []) nights.add(n);
    out.set(key, nights.size);
  }
  return out;
}

export async function issueRefineryClaims(
  db: Db,
  tick: { runId: number; windows: TickWindows; verdicts: VerdictRow[]; names: Map<string, string[]> },
  now: Date = new Date(),
): Promise<ClaimsResult> {
  const result: ClaimsResult = { issuing: false, reason: '', issued: 0, by_family: {}, declined: {}, error: null };
  const decline = (k: string, n = 1) => { result.declined[k] = (result.declined[k] ?? 0) + n; };
  const w = tick.windows;
  try {
    const last = await newestIssuingClock(db);
    if (!isIssuingTick(w.data_clock_night, last)) {
      result.reason = `alternate ticks: the last issuing tick's data clock is ${last}; the next issues at ${addDays(last as string, ISSUE_EVERY_NIGHTS)} or later`;
      return result;
    }
    result.issuing = true;

    const firmsClock = await firmsDataClock(db);
    if (!firmsClock) throw new Error('FIRMS clock unknown — no refinery observations');

    const { data: mon, error: monErr } = await db.rpc('refinery_rc_walkforward');
    if (monErr || !mon) throw new Error(`monitor: ${monErr?.message ?? 'no data'}`);
    const monitor = mon as Monitor;

    const candidates = candidatesFor(tick.verdicts, w, firmsClock);
    if (candidates.length === 0) {
      result.reason = 'issuing tick; no complex is thermally dark (REFUTED or LEAD) — nothing to claim';
      return result;
    }

    // existing windows per (family, complex): no two claims of one family on one complex share a night
    const existing = await recentClaims(db, new Date(now.getTime() - 90 * 86_400_000));
    const lastEnd = new Map<string, { end: string; public_id: string }>();
    for (const e of existing) {
      const ctx = e.context ?? {};
      const key = `${e.feature}|${String(ctx.cluster_key ?? '')}`;
      const end = String(ctx.window_end ?? '');
      const prev = lastEnd.get(key);
      if (end && (!prev || end > prev.end)) lastEnd.set(key, { end, public_id: e.public_id });
    }

    const lightMembers = new Map<string, string[]>();
    for (const c of candidates) {
      if (c.family === 'rc_site_stays_lit' || c.family === 'rc_lead_light_persists') lightMembers.set(c.row.cluster_key, c.row.members);
    }
    const onDisk = lightMembers.size
      ? await nightsOnDisk(db, lightMembers, addDays(w.data_clock_night, 1), addDays(w.data_clock_night, CLAIM_DAYS))
      : new Map<string, number>();

    const rows: Array<Record<string, unknown>> = [];
    for (const c of candidates) {
      const fam = monitor.families?.[c.family];
      if (!fam) { decline(`${c.family}: monitor has no line for the family`); continue; }
      if (fam.status === 'suspended') { decline(`${c.family}: suspended — ${fam.reason ?? 'negative split-half skill'}`); continue; }
      const prev = lastEnd.get(`${c.family}|${c.row.cluster_key}`);
      if (prev && prev.end >= c.window_start) {
        decline(`${c.family}: window overlaps ${prev.public_id} (ends ${prev.end})`);
        continue;
      }
      const names = tick.names.get(c.row.cluster_key) ?? c.row.members;
      const label = names.length <= 2 ? names.join(' / ') : `${names.slice(0, 2).join(' / ')} +${names.length - 2}`;
      const light = c.family === 'rc_site_stays_lit' || c.family === 'rc_lead_light_persists';
      rows.push(buildClaimRow({
        c, label, memberNames: names, w, runId: tick.runId, fam, firmsClock,
        nightsOnDisk: light ? onDisk.get(c.row.cluster_key) ?? 0 : null, now,
      }));
    }

    if (rows.length > 0) {
      const { data: ins, error: insErr } = await db.from('predictions_register').insert(rows).select('id, feature');
      if (insErr) throw new Error(`insert: ${insErr.message}`);
      for (const r of (ins ?? []) as Array<{ feature: string }>) {
        result.issued += 1;
        result.by_family[r.feature] = (result.by_family[r.feature] ?? 0) + 1;
      }
    }
    result.reason = `issuing tick: ${result.issued} claim(s) over ${new Set(candidates.map((c) => c.row.cluster_key)).size} dark complex(es)`;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    await recordIssuanceRun(db as unknown as Parameters<typeof recordIssuanceRun>[0], {
      source: SOURCE, issued: result.issued, already_present: null,
      declined: result.issuing ? result.declined : { [`not an issuing tick: ${result.reason}`]: 1 },
      error: result.error,
    });
  }
  return result;
}
