import { ksStatistic, ksPValue } from '@/lib/intel/ks';

/**
 * Reality Check — the refinery classifier (PR-5, build prompt §3.1, D-2…D-8,
 * D-13, D-14). Pure functions only: no I/O, no clock, no Supabase. The tick
 * (./tick.ts) feeds it one complex at a time and writes what it returns into
 * reality_check_site_verdicts, whose CHECKs (migs 161 + 169) re-derive every
 * state from the stored numbers — so a wrong verdict here fails at INSERT.
 *
 * THE PINNED METHOD. These values are the reality_check_runs CHECK
 * (rcr_method_pinned, rcr_ks_split_pinned). The tick writes them onto every
 * run row from here, so a drift between this file and the database refuses
 * the run instead of publishing it. Changing one is a migration and a
 * ledger_change_log row (D-5), never an edit to this object alone.
 *
 * MEDIANS ONLY. The input is the per-night MEDIAN over a complex's members
 * (refinery_complex_light_nights, mig 161); the statistic is the median over
 * those nights. There is no average anywhere in this path (§3.2 guard 1,
 * scripts/reality-check/check-no-mean.mjs).
 *
 * EXACT COMPARISONS. Stored medians carry 6 decimals and every threshold is
 * decided on the stored value in integer micro-units — 5·w < 3·b ⇔ w < 0.60·b
 * — so the verdict here and the CHECK in Postgres can never disagree on a
 * boundary.
 */
export const METHOD = {
  window_nights: 15,
  baseline_nights: 31,
  statistic: 'median',
  light_column: 'radiance',
  robustness_column: 'radiance_3x3',
  robustness_min_px_hq: 5,
  clear_night_rule: 'confident_clear',
  census_usable_ratio: 0.95,
  light_down_ratio: 0.6,
  heat_down_ratio: 0.6,
  heat_observable_floor: 0.2,
  heat_rate_rule: 'days_with_detection_over_firms_days',
  min_baseline_nights: 5,
  min_window_nights: 3,
  ks_min_baseline_nights: 12,
  ks_alpha: 0.05,
  complex_rule: 'single_linkage_geography_5000m_rfc_rematch_2500m_pooled_nightly_median',
  complex_linkage_m: 5000,
  complex_rematch_m: 2500,
  ks_split_rule: 'baseline_halves_by_count',
} as const;

export const CLASSIFIER_VERSION = 'rc-tick-v1 (PR-5)';

export type Verdict =
  | 'STEADY' | 'LIGHT_DOWN_ONLY' | 'REFUTED' | 'LEAD'
  | 'VOID_NOT_OBSERVED' | 'VOID_INSUFFICIENT_NIGHTS' | 'VOID_BASELINE_UNSTABLE' | 'VOID_HEAT_NOT_OBSERVABLE';
export type HeatState = 'HEAT_DOWN' | 'HEAT_STEADY' | 'HEAT_NOT_OBSERVABLE';
export type Coverage = 'OBSERVED' | 'BELOW_FLOOR' | 'NOT_OBSERVED';

/** One complex's inputs, as reality_check_tick_inputs() returns them (mig 169). */
export interface ComplexInputs {
  cluster_key: string;
  members: string[];
  member_names: string[];
  light_nights: string[];                  // ISO dates, ascending
  radiance_median: Array<number | null>;   // per-night median radiance (primary, D-4)
  radiance_3x3_median: Array<number | null>; // per-night median radiance_3x3, px_hq_3x3 >= 5
  heat_days: string[];                     // usable FIRMS days with a member row, ascending
  heat_day: boolean[];                     // any member detection that day
  non_refinery_members: number;
}

/** Explicit inclusive dates (D-6). */
export interface TickWindows {
  data_clock_night: string;
  window_start: string;
  window_end: string;
  baseline_start: string;
  baseline_end: string;
}

/** The row written to reality_check_site_verdicts (generated columns omitted). */
export interface VerdictRow {
  cluster_key: string;
  members: string[];
  member_count: number;
  verdict: Verdict;
  coverage_state: Coverage;
  baseline_nights: number;
  window_nights: number;
  baseline_median: number | null;
  window_median: number | null;
  baseline_min: number | null;
  baseline_max: number | null;
  window_min: number | null;
  window_max: number | null;
  r3_baseline_nights: number;
  r3_window_nights: number;
  r3_baseline_median: number | null;
  r3_window_median: number | null;
  robustness_verdict: Verdict | null;
  baseline_firms_days: number;
  baseline_heat_days: number;
  window_firms_days: number;
  window_heat_days: number;
  heat_state: HeatState;
  ks_tested: boolean | null;
  ks_d: number | null;
  ks_p: number | null;
}

// ─── dates ───────────────────────────────────────────────────────────────
const DAY = 86_400_000;
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/** D-6: window = the 15 nights ending on the data-clock night; baseline = the 31 before. */
export function windowsFor(dataClockNight: string): TickWindows {
  const window_end = dataClockNight;
  const window_start = addDays(window_end, -(METHOD.window_nights - 1));
  const baseline_end = addDays(window_start, -1);
  const baseline_start = addDays(baseline_end, -(METHOD.baseline_nights - 1));
  return { data_clock_night: dataClockNight, window_start, window_end, baseline_start, baseline_end };
}

// ─── the statistic ───────────────────────────────────────────────────────
/** Median (percentile_cont(0.5) semantics: the middle value, or the midpoint of the two). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Integer micro-units: the exact decimal the database stores (6 places). */
export function micro(v: number): number {
  return Math.round(v * 1e6);
}
export function fromMicro(m: number): number {
  return m / 1e6;
}
/** light down ⇔ window < 0.60 × baseline ⇔ 5·w < 3·b, on stored values. */
export function lightDown(windowMedianMicro: number, baselineMedianMicro: number): boolean {
  return 5 * windowMedianMicro < 3 * baselineMedianMicro;
}

interface Series { values: number[]; min: number | null; max: number | null; medianMicro: number | null }
function series(values: number[]): Series {
  const med = median(values);
  return {
    values,
    min: values.length ? fromMicro(micro(Math.min(...values))) : null,
    max: values.length ? fromMicro(micro(Math.max(...values))) : null,
    medianMicro: med === null ? null : micro(med),
  };
}

function split(inp: ComplexInputs, w: TickWindows, which: 'primary' | 'r3') {
  const vals = which === 'primary' ? inp.radiance_median : inp.radiance_3x3_median;
  const base: number[] = [];
  const win: number[] = [];
  inp.light_nights.forEach((night, i) => {
    const v = vals[i];
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return; // NULL is "no retrieval", never 0
    if (night >= w.baseline_start && night <= w.baseline_end) base.push(Number(v));
    else if (night >= w.window_start && night <= w.window_end) win.push(Number(v));
  });
  return { base: series(base), win: series(win) };
}

/**
 * The stability test (§3.1, ks_split_rule): the baseline's usable nights in
 * date order, the first ⌊n/2⌋ against the rest, lib/intel/ks.ts — never a
 * second KS. Run only at n >= 12.
 */
export function stabilityTest(baselineInDateOrder: number[]): { d: number; p: number } {
  const n1 = Math.floor(baselineInDateOrder.length / 2);
  const a = baselineInDateOrder.slice(0, n1);
  const b = baselineInDateOrder.slice(n1);
  const d = ksStatistic(a, b);
  const p = ksPValue(d, a.length, b.length);
  return { d: Math.round(d * 1e6) / 1e6, p: Math.round(p * 1e6) / 1e6 };
}

/** Heat (§3.1): days with >= 1 detection over FIRMS days; three-valued; exact integers. */
export function heatState(bf: number, bh: number, wf: number, wh: number): HeatState {
  const observable = bf > 0 && 5 * bh > bf && wf > 0;
  if (!observable) return 'HEAT_NOT_OBSERVABLE';
  return 5 * wh * bf < 3 * bh * wf ? 'HEAT_DOWN' : 'HEAT_STEADY';
}

/**
 * The ladder, first match wins. Coverage and every VOID come before any
 * reading; the stability test outranks heat (a failed test forces
 * VOID_BASELINE_UNSTABLE, rcsv_ks_failure_forces_void). A dual-down complex
 * below 12 baseline nights cannot be a LEAD (no stability test, §3.1) and is
 * VOID_INSUFFICIENT_NIGHTS (mig 169).
 */
function ladder(args: {
  bn: number; wn: number; bMedMicro: number | null; wMedMicro: number | null;
  heat: HeatState; ksTested: boolean | null; ksFailed: boolean;
}): Verdict {
  const { bn, wn, bMedMicro, wMedMicro, heat, ksTested, ksFailed } = args;
  if (wn === 0) return 'VOID_NOT_OBSERVED';
  if (bn < METHOD.min_baseline_nights || wn < METHOD.min_window_nights) return 'VOID_INSUFFICIENT_NIGHTS';
  if (ksFailed) return 'VOID_BASELINE_UNSTABLE';
  if (heat === 'HEAT_NOT_OBSERVABLE') return 'VOID_HEAT_NOT_OBSERVABLE';
  const down = lightDown(wMedMicro as number, bMedMicro as number);
  if (heat === 'HEAT_DOWN') {
    if (!down) return 'REFUTED';
    return ksTested === true ? 'LEAD' : 'VOID_INSUFFICIENT_NIGHTS';
  }
  return down ? 'LIGHT_DOWN_ONLY' : 'STEADY';
}

export function coverageOf(bn: number, wn: number): Coverage {
  if (wn === 0) return 'NOT_OBSERVED';
  if (bn >= METHOD.min_baseline_nights && wn >= METHOD.min_window_nights) return 'OBSERVED';
  return 'BELOW_FLOOR';
}

export function classifyComplex(inp: ComplexInputs, w: TickWindows): VerdictRow {
  const primary = split(inp, w, 'primary');
  const r3 = split(inp, w, 'r3');
  const bn = primary.base.values.length;
  const wn = primary.win.values.length;
  const coverage = coverageOf(bn, wn);

  let bf = 0, bh = 0, wf = 0, wh = 0;
  inp.heat_days.forEach((day, i) => {
    const hot = inp.heat_day[i] === true;
    if (day >= w.baseline_start && day <= w.baseline_end) { bf++; if (hot) bh++; }
    else if (day >= w.window_start && day <= w.window_end) { wf++; if (hot) wh++; }
  });
  const heat = heatState(bf, bh, wf, wh);

  // The stability test runs only on an OBSERVED complex (a BELOW_FLOOR row
  // must stay VOID_INSUFFICIENT_NIGHTS, which a failed test could not be).
  let ksTested: boolean | null = null;
  let ksD: number | null = null;
  let ksP: number | null = null;
  if (coverage === 'OBSERVED') {
    ksTested = bn >= METHOD.ks_min_baseline_nights;
    if (ksTested) {
      const t = stabilityTest(primary.base.values);
      ksD = t.d;
      ksP = t.p;
    }
  }
  const ksFailed = ksTested === true && micro(ksP as number) < micro(METHOD.ks_alpha);

  const verdict = ladder({
    bn, wn, bMedMicro: primary.base.medianMicro, wMedMicro: primary.win.medianMicro,
    heat, ksTested, ksFailed,
  });

  // D-4 / D-13: the same ladder on radiance_3x3, with the primary's heat state
  // and stability result — only the light statistic changes. None on a VOID.
  let robustness: Verdict | null = null;
  if (!verdict.startsWith('VOID_')) {
    robustness = ladder({
      bn: r3.base.values.length, wn: r3.win.values.length,
      bMedMicro: r3.base.medianMicro, wMedMicro: r3.win.medianMicro,
      heat, ksTested, ksFailed: false,
    });
  }

  const m = (x: number | null) => (x === null ? null : fromMicro(x));
  return {
    cluster_key: inp.cluster_key,
    members: inp.members,
    member_count: inp.members.length,
    verdict,
    coverage_state: coverage,
    baseline_nights: bn,
    window_nights: wn,
    baseline_median: m(primary.base.medianMicro),
    window_median: m(primary.win.medianMicro),
    baseline_min: primary.base.min,
    baseline_max: primary.base.max,
    window_min: primary.win.min,
    window_max: primary.win.max,
    r3_baseline_nights: r3.base.values.length,
    r3_window_nights: r3.win.values.length,
    r3_baseline_median: m(r3.base.medianMicro),
    r3_window_median: m(r3.win.medianMicro),
    robustness_verdict: robustness,
    baseline_firms_days: bf,
    baseline_heat_days: bh,
    window_firms_days: wf,
    window_heat_days: wh,
    heat_state: heat,
    ks_tested: ksTested,
    ks_d: ksD,
    ks_p: ksP,
  };
}

/**
 * The five funnel terms (§2.2), counted by complex, with facility rows beside them.
 *
 * `rows` are the MEMBERS of the complexes counted at each term (one complex
 * verdict, all its members) — not a facility-by-facility classification. The
 * two agree on the dark and outcome terms but not upstream: on the first-tick
 * windows, pre-168 population, the complexes give 338 → 250 (319 member rows)
 * → 86 (134) → 10 (12) → 9 (11) + 1 (1), while classifying each facility on
 * its own gives the published 431 → 312 → 125 → 12 → 11 + 1. Any surface
 * quoting a row figure must say which one it is.
 */
export interface Funnel {
  watched: number; observed: number; heat_observable: number; thermally_dark: number;
  refuted: number; lead: number; dark_withheld: number;
  rows: { watched: number; observed: number; heat_observable: number; thermally_dark: number; refuted: number; lead: number };
  robustness: { observed: number; heat_observable: number; thermally_dark: number; refuted: number; lead: number };
  not_robust: string[];
  verdicts: Record<string, number>;
}

export function funnelOf(rows: VerdictRow[]): Funnel {
  const count = (f: (r: VerdictRow) => boolean) => rows.filter(f).length;
  const sumRows = (f: (r: VerdictRow) => boolean) => rows.filter(f).reduce((s, r) => s + r.member_count, 0);
  const obs = (r: VerdictRow) => r.coverage_state === 'OBSERVED';
  const hobs = (r: VerdictRow) => obs(r) && r.heat_state !== 'HEAT_NOT_OBSERVABLE';
  const dark = (r: VerdictRow) => obs(r) && r.heat_state === 'HEAT_DOWN';
  const r3obs = (r: VerdictRow) => r.r3_baseline_nights >= METHOD.min_baseline_nights && r.r3_window_nights >= METHOD.min_window_nights;
  const r3down = (r: VerdictRow) => lightDown(micro(r.r3_window_median as number), micro(r.r3_baseline_median as number));
  const verdicts: Record<string, number> = {};
  for (const r of rows) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
  return {
    watched: rows.length,
    observed: count(obs),
    heat_observable: count(hobs),
    thermally_dark: count(dark),
    refuted: count((r) => r.verdict === 'REFUTED'),
    lead: count((r) => r.verdict === 'LEAD'),
    dark_withheld: count((r) => dark(r) && r.verdict.startsWith('VOID_')),
    rows: {
      watched: sumRows(() => true),
      observed: sumRows(obs),
      heat_observable: sumRows(hobs),
      thermally_dark: sumRows(dark),
      refuted: sumRows((r) => r.verdict === 'REFUTED'),
      lead: sumRows((r) => r.verdict === 'LEAD'),
    },
    robustness: {
      observed: count(r3obs),
      heat_observable: count((r) => r3obs(r) && r.heat_state !== 'HEAT_NOT_OBSERVABLE'),
      thermally_dark: count((r) => r3obs(r) && r.heat_state === 'HEAT_DOWN'),
      refuted: count((r) => r3obs(r) && r.heat_state === 'HEAT_DOWN' && !r3down(r)),
      lead: count((r) => r3obs(r) && r.heat_state === 'HEAT_DOWN' && r3down(r)),
    },
    not_robust: rows
      .filter((r) => r.robustness_verdict !== null && r.robustness_verdict !== r.verdict)
      .map((r) => `${r.cluster_key}: ${r.verdict} → ${r.robustness_verdict} on radiance_3x3`),
    verdicts,
  };
}
