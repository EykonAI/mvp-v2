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
 *                          nights of its light window (below), the median
 *                          clear-night radiance stays >= 0.60 × baseline.
 *   rc_lead_light_persists every LEAD complex — the same median stays below.
 *   rc_refutation_holds    every REFUTED complex — not a LEAD in either of
 *                          the next two published ticks (near-certain). A
 *                          tick counts only if a LEAD was possible there
 *                          (non-VOID, >= 12 baseline nights); none → VOID.
 *                          Its nominal window is the 14 nights after the
 *                          tick's data clock (the nights those ticks add).
 *
 * NOTHING OF A LIGHT OR HEAT WINDOW IS ON DISK AT ISSUE (founder, 2026-09-19,
 * decision C). Refutation holds is outside the rule: it resolves on the next
 * two ticks, which do not exist at issue; its nominal window is informational
 * (the resolver reads tick_data_clock) and may start on a night already
 * partly on disk (09-09 on the first tick) — window_nights_on_disk_at_issue
 * is null for it.
 * The light window starts on the first night strictly after the newest night
 * that holds ANY blackmarble_facility_radiance row (any facility type) when
 * the claim issues, and runs 14 nights. The BM data clock is the newest
 * USABLE night, so a partly ingested later night (09-09 at 405/449 rows on
 * 09-19) would otherwise open the window. The heat window already starts the
 * day after the FIRMS clock (the newest refinery FIRMS day on disk). Both are
 * asserted twice: by construction (start > the instrument's newest night on
 * disk) and by measurement — window_nights_on_disk_at_issue counts the
 * window's nights holding a row for a member, is recorded on the claim, and
 * must be 0, or nothing issues (the error is in issuance_runs).
 *
 * NO SELECTION. Which complexes get a claim is fixed by the tick's verdicts
 * (nights up to the data clock only); the number on the claim is the family's
 * walk-forward record, p = (k + 20 × 0.5)/(n + 20) (mig-149 shrinkage, read
 * from refinery_rc_walkforward(), mig 169), frozen with k and n. The window
 * dates are fixed by the calendar and the on-disk frontier, never by a value.
 * The resolver (refinery_rc_resolution, mig 170) reads them from the claim.
 *
 * NO OVERLAP. Windows are 14 nights (two ticks) and claims issue on
 * ALTERNATE ticks: a tick issues only when its data clock is >= 14 nights past
 * the last issuing tick's (reality_check_runs.claims_issued marks issuing
 * ticks), and a superseding tick never issues. Because the light window now
 * starts after the on-disk frontier rather than the data clock, the frontier's
 * lead over the clock can shrink between issuing ticks (a backlog lands in
 * full); the light window then starts the night after the newest light window
 * already claimed, so consecutive windows touch and never overlap. Each
 * candidate is also checked against the family's existing claims on the
 * complex, so no two claims of one family on one complex share a night even
 * when ticks are irregular. The one-claim-per-observable trigger (mig 150) is
 * the backstop.
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

export function isLightFamily(f: string): boolean {
  return f === 'rc_site_stays_lit' || f === 'rc_lead_light_persists';
}

/** What fixes the windows at issue: the instruments' newest nights on disk and the newest light window already claimed. */
export interface WindowClocks {
  /** the FIRMS clock: the newest refinery FIRMS day on disk */
  firms: string;
  /** the newest night holding ANY blackmarble_facility_radiance row (any facility type) */
  bmNewestOnDisk: string;
  /** the newest window_end among the light-family claims already on the register, or null */
  lastLightWindowEnd: string | null;
}

/**
 * Decision C (founder, 2026-09-19): the light window starts on the first night
 * strictly after the newest Black Marble night on disk at issue. Floors: the
 * night after the tick's data clock (the frontier is never behind it; kept so
 * a window can never reach back into the tick), and the night after the newest
 * light window already claimed (the frontier's lead over the clock can shrink
 * between issuing ticks; without this floor the two windows would share nights
 * and the per-complex check would decline the whole family on that tick).
 */
export function lightWindowStart(dataClock: string, bmNewestOnDisk: string, lastLightWindowEnd: string | null): string {
  let start = addDays(dataClock, 1);
  const frontier = addDays(bmNewestOnDisk, 1);
  if (frontier > start) start = frontier;
  if (lastLightWindowEnd !== null) {
    const after = addDays(lastLightWindowEnd, 1);
    if (after > start) start = after;
  }
  return start;
}

/** Which claims a tick's verdicts call for (§3.5). Pure; throws if a window would start on a night already on disk. */
export function candidatesFor(verdicts: VerdictRow[], w: TickWindows, clocks: WindowClocks): Candidate[] {
  const out: Candidate[] = [];
  const lightStart = lightWindowStart(w.data_clock_night, clocks.bmNewestOnDisk, clocks.lastLightWindowEnd);
  const lightEnd = addDays(lightStart, CLAIM_DAYS - 1);
  const heatStart = addDays(clocks.firms, 1);
  const heatEnd = addDays(clocks.firms, CLAIM_DAYS);
  const ticksStart = addDays(w.data_clock_night, 1);
  const ticksEnd = addDays(w.data_clock_night, CLAIM_DAYS);
  // decision C, by construction: no window starts on or before its instrument's newest night on disk
  if (lightStart <= clocks.bmNewestOnDisk) {
    throw new Error(`light window would start ${lightStart}, on or before the newest Black Marble night on disk (${clocks.bmNewestOnDisk})`);
  }
  if (heatStart <= clocks.firms) {
    throw new Error(`heat window would start ${heatStart}, on or before the FIRMS clock (${clocks.firms})`);
  }
  for (const r of verdicts) {
    if (r.verdict === 'REFUTED' || r.verdict === 'LEAD') {
      out.push({ family: 'rc_heat_dark_persists', row: r, window_start: heatStart, window_end: heatEnd });
    }
    if (r.verdict === 'REFUTED') {
      out.push({ family: 'rc_site_stays_lit', row: r, window_start: lightStart, window_end: lightEnd });
      out.push({ family: 'rc_refutation_holds', row: r, window_start: ticksStart, window_end: ticksEnd });
    }
    if (r.verdict === 'LEAD') {
      out.push({ family: 'rc_lead_light_persists', row: r, window_start: lightStart, window_end: lightEnd });
    }
  }
  return out;
}

/** Decision C, by measurement: every count must be 0, or nothing issues. */
export function assertNothingOnDisk(instrument: string, start: string, end: string, counts: Map<string, number>): void {
  const bad = [...counts].filter(([, n]) => n !== 0);
  if (bad.length > 0) {
    throw new Error(`${instrument} window ${start}..${end} already holds rows at issue for ${bad.map(([k, n]) => `${k} (${n} night(s))`).join(', ')} — a claim window must start after the data on disk (decision C, 2026-09-19); nothing issued`);
  }
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
  fam: MonitorFamily; firmsClock: string; bmNewestOnDisk: string; nightsOnDisk: number | null; now: Date;
}): Record<string, unknown> {
  const { c, label, memberNames, w, runId, fam, firmsClock, bmNewestOnDisk, nightsOnDisk, now } = args;
  const r = c.row;
  const p = shrunkRate(fam.k, fam.judged);
  const statement = statementFor(c, label, w);
  const targetObservable = observable(c.family, r.cluster_key, c.window_start, c.window_end);
  // Judgeable the day after the window closes; the resolver DEFERS until the
  // instrument has finalised it. Never before issue.
  const nominal = new Date(`${addDays(c.window_end, 1)}T00:00:00.000Z`);
  const resolvesAt = nominal.getTime() > now.getTime() ? nominal : new Date(now.getTime() + 3_600_000);
  const hash = computePredictionHash({ statement, targetObservable, resolvesAt, issuedAt: now, predictedMean: p });
  const light = isLightFamily(c.family);
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
      // Decision C: the light window starts the night after this (or after
      // the newest light window already claimed, whichever is later).
      bm_newest_night_on_disk_at_issue: light ? bmNewestOnDisk : undefined,
      // How many of the window's nights (FIRMS days for the heat family)
      // already held a row for a member when this claim was issued — always 0
      // (asserted at issue). Recorded so a reader can check it, not trust it.
      // Null for refutation holds, whose instrument is the later ticks.
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

/**
 * The newest night holding ANY Black Marble row, every facility type (decision
 * C). One index-only scan on idx_bm_radiance_period (period DESC), LIMIT 1.
 */
async function bmNewestNightOnDisk(db: Db): Promise<string | null> {
  const { data, error } = await db
    .from('blackmarble_facility_radiance')
    .select('period')
    .order('period', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Black Marble frontier read: ${error.message}`);
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

/** Nights (FIRMS: days) in [start, end] holding any row of `table` for the members, per complex. Keyed index reads. */
async function nightsOnDisk(
  db: Db, table: 'blackmarble_facility_radiance' | 'firms_facility_observations',
  members: Map<string, string[]>, start: string, end: string,
): Promise<Map<string, number>> {
  const ids = [...new Set([...members.values()].flat())];
  const byFacility = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from(table)
        .select('facility_id, period')
        .eq('facility_type', 'refinery')
        .in('facility_id', chunk)
        .gte('period', start)
        .lte('period', end)
        .order('facility_id', { ascending: true })
        .order('period', { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`window rows read (${table}): ${error.message}`);
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
    const bmNewest = await bmNewestNightOnDisk(db);
    if (!bmNewest) throw new Error('Black Marble frontier unknown — no rows on disk');

    const { data: mon, error: monErr } = await db.rpc('refinery_rc_walkforward');
    if (monErr || !mon) throw new Error(`monitor: ${monErr?.message ?? 'no data'}`);
    const monitor = mon as Monitor;

    // existing windows per (family, complex): no two claims of one family on one complex share a night;
    // and the newest light window already claimed (a floor for the next light window, decision C)
    const existing = await recentClaims(db, new Date(now.getTime() - 90 * 86_400_000));
    const lastEnd = new Map<string, { end: string; public_id: string }>();
    let lastLightWindowEnd: string | null = null;
    for (const e of existing) {
      const ctx = e.context ?? {};
      const key = `${e.feature}|${String(ctx.cluster_key ?? '')}`;
      const end = String(ctx.window_end ?? '');
      const prev = lastEnd.get(key);
      if (end && (!prev || end > prev.end)) lastEnd.set(key, { end, public_id: e.public_id });
      if (end && isLightFamily(e.feature) && (lastLightWindowEnd === null || end > lastLightWindowEnd)) lastLightWindowEnd = end;
    }

    const candidates = candidatesFor(tick.verdicts, w, { firms: firmsClock, bmNewestOnDisk: bmNewest, lastLightWindowEnd });
    if (candidates.length === 0) {
      result.reason = 'issuing tick; no complex is thermally dark (REFUTED or LEAD) — nothing to claim';
      return result;
    }

    // decision C, by measurement: no window night already holds a row for a member.
    // All light candidates share one window, all heat candidates another.
    const light = candidates.filter((c) => isLightFamily(c.family));
    const heat = candidates.filter((c) => c.family === 'rc_heat_dark_persists');
    const measure = async (cs: Candidate[], table: 'blackmarble_facility_radiance' | 'firms_facility_observations', instrument: string) => {
      if (cs.length === 0) return new Map<string, number>();
      const { window_start: s, window_end: e } = cs[0];
      const counts = await nightsOnDisk(db, table, new Map(cs.map((c) => [c.row.cluster_key, c.row.members])), s, e);
      assertNothingOnDisk(instrument, s, e, counts);
      return counts;
    };
    const onDiskLight = await measure(light, 'blackmarble_facility_radiance', 'Black Marble');
    const onDiskHeat = await measure(heat, 'firms_facility_observations', 'FIRMS');

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
      const onDisk = isLightFamily(c.family) ? onDiskLight : c.family === 'rc_heat_dark_persists' ? onDiskHeat : null;
      rows.push(buildClaimRow({
        c, label, memberNames: names, w, runId: tick.runId, fam, firmsClock, bmNewestOnDisk: bmNewest,
        nightsOnDisk: onDisk ? onDisk.get(c.row.cluster_key) ?? 0 : null, now,
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
