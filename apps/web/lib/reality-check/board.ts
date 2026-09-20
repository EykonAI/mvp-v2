/**
 * Reality Check — the board's presentation layer (PR-6, build prompt §3.3).
 *
 * Pure functions and constant tables only: no React, no fetch, no clock. The
 * workspace components render what is here, and
 * apps/web/scripts/reality-check/test-rc-board.mjs (CI job
 * reality-check / unit) asserts it — so the rules below are tested rather
 * than trusted.
 *
 * WHAT THIS FILE IS NOT. It is not a second copy of the classifier (§5.3).
 * Nothing here applies a threshold to a measurement or derives a verdict: the
 * verdicts, the funnel terms and every parameter come from the single
 * accessor reality_check_tick() (migration 171), which reads what the tick
 * froze. This file decides only how that is SHOWN.
 *
 * THREE RULES THE PROTOTYPE BROKE, AND THIS FILE FIXES (§3.6):
 *   1. Every row state has a visual treatment — STEADY and LIGHT_DOWN_ONLY
 *      included, and all four VOID states. Silence is not a verdict, so it
 *      gets a treatment that says so rather than no treatment at all.
 *   2. The refutation cell is the hero and the lead is never the headline.
 *      REFUTED sorts first and carries the loudest tone; LEAD is amber, not
 *      red, because red would read as an outage this board has established —
 *      the one thing it refuses to say.
 *   3. A night that was not looked at is a GAP, never a zero. Radiance of
 *      exactly 0 occurs 18 times in genuine observations (§2.3), so zero can
 *      never be a sentinel for missing data.
 */

// ─── the payload, as reality_check_tick() returns it ─────────────────────
export type Verdict =
  | 'STEADY' | 'LIGHT_DOWN_ONLY' | 'REFUTED' | 'LEAD'
  | 'VOID_NOT_OBSERVED' | 'VOID_INSUFFICIENT_NIGHTS'
  | 'VOID_BASELINE_UNSTABLE' | 'VOID_HEAT_NOT_OBSERVABLE';

export type MaskTier = 'public' | 'member' | 'pro';

export interface FunnelTerm { complexes: number; rows: number }

export interface TickLocation {
  iso_country: string | null;
  country: string | null;
  city: string | null;
  us_state: string | null;
  multi_country: boolean;
  latitude: number | null;
  longitude: number | null;
  note: string;
}

export interface BoardRow {
  cluster_key: string;
  site_name: string | null;
  name_masked: boolean;
  member_count: number;
  member_names: string[] | null;
  members: string[] | null;
  location: TickLocation | null;
  verdict: Verdict;
  coverage_state: 'OBSERVED' | 'BELOW_FLOOR' | 'NOT_OBSERVED';
  heat_state: 'HEAT_DOWN' | 'HEAT_STEADY' | 'HEAT_NOT_OBSERVABLE' | null;
  light: {
    baseline_nights: number; window_nights: number;
    baseline_median: number | null; window_median: number | null;
    baseline_min: number | null; baseline_max: number | null;
    window_min: number | null; window_max: number | null;
    ratio: number | null; distributions_overlap: boolean | null;
  };
  heat: {
    baseline_firms_days: number; baseline_heat_days: number;
    window_firms_days: number; window_heat_days: number;
    baseline_rate: number | null; window_rate: number | null;
  };
  robustness: {
    verdict: Verdict | null; robust_to_retrieval: boolean | null;
    baseline_nights: number; window_nights: number;
    baseline_median: number | null; window_median: number | null; ratio: number | null;
  };
  stability: { tested: boolean | null; d: number | null; p: number | null };
  capacity: { established: boolean; label: string; reason: string };
}

export interface DrilldownNight {
  night: string;
  phase: 'baseline' | 'window';
  light_state: 'NIGHT_NOT_USABLE' | 'NOT_INGESTED' | 'NOT_CLEAR' | 'CLEAR_NO_RETRIEVAL' | 'OBSERVED';
  radiance_median: number | null;
  radiance_3x3_median: number | null;
  clear_members: number | null;
  retrieval_members: number | null;
  heat_state: 'DAY_NOT_USABLE' | 'NOT_INGESTED' | 'NO_DETECTION' | 'DETECTION';
  detecting_members: number | null;
}

export interface TickPayload {
  published: true;
  tier: MaskTier;
  asset_class: string;
  tick: string;
  revision: number;
  published_at: string;
  data_clock_night: string;
  windows: {
    baseline_start: string; baseline_end: string;
    window_start: string; window_end: string;
    baseline_nights: number; window_nights: number; rule: string;
  };
  parameters: Record<string, unknown>;
  funnel: {
    counted_by: string;
    watched: FunnelTerm; observed: FunnelTerm; heat_observable: FunnelTerm;
    thermally_dark: FunnelTerm; refuted: FunnelTerm; lead: FunnelTerm; withheld: FunnelTerm;
  };
  counts_by_verdict: Record<Verdict, number>;
  robustness: {
    column: string; min_px_hq: number;
    observed: number; heat_observable: number; thermally_dark: number;
    refuted: number; lead: number;
    not_robust: Array<{ cluster_key: string; verdict: Verdict; robustness_verdict: Verdict }>;
  };
  claims: {
    issued_on_this_tick: number | null;
    at_publication: WalkforwardBlock | null;
    live: WalkforwardBlock | null;
  };
  coverage: {
    bm_nights_used: string[] | null;
    firms_days_used: string[] | null;
    calendar_nights: number;
    note: string;
  };
  integrity: { content_hash: string; recomputed: string; hash_matches: boolean; frozen: boolean };
  supersession: {
    current: boolean;
    superseded_by: { tick: string; published_at: string } | null;
    supersedes: string | null;
  };
  archive: Array<{
    tick: string; revision: number; data_clock_night: string;
    window_start: string; window_end: string; published_at: string;
    refuted: number; lead: number; current: boolean;
  }>;
  rows: BoardRow[];
  mask: { tier: MaskTier; lead_names: string; drilldown: string; archive: string };
  drilldown?: { cluster_key: string; nights?: DrilldownNight[]; withheld?: boolean; reason?: string };
  as_of: string;
}

export interface TickEmpty {
  published: false;
  asset_class: string;
  tier: MaskTier;
  requested_tick: string | null;
  empty_reason: string;
  runs_total: number;
  runs_complete: number;
  as_of: string;
}

export type TickResponse = TickPayload | TickEmpty;

export interface WalkforwardFamily {
  order: number; near_certain: boolean | null;
  issued: number; judged: number; k: number; void: number; open: number;
  base_rate: number | null; brier: number | null; hit_rate: number | null;
  skill: number | null; skill_half_1: number | null; skill_half_2: number | null;
  n_half_1: number; n_half_2: number; p_next: number | null;
  status: 'calibrating' | 'suspended' | 'scored';
  reason: string;
}
export interface WalkforwardBlock {
  as_of?: string; source?: string; track?: string;
  min_judged?: number; alpha?: number; rule?: string;
  families?: Record<string, WalkforwardFamily>;
  error?: string;
}

// ─── every row state has a treatment (§3.3) ──────────────────────────────
export interface VerdictPresentation {
  /** The pill's words. Short enough to stay on one line at 13px root. */
  label: string;
  /** The drill-down banner's words — louder, and never abbreviated. */
  banner: string;
  /** One line a subscriber can read without the method block. */
  gloss: string;
  /** CSS modifier, appended to rc-v- / rc-vb-. */
  tone: 'refuted' | 'lead' | 'watch' | 'steady' | 'void';
  /** Sort rank: the refutation cell is the hero, the lead is never the headline. */
  rank: number;
  /** A VOID state withholds a verdict rather than stating one. */
  withheld: boolean;
}

export const VERDICTS: Record<Verdict, VerdictPresentation> = {
  REFUTED: {
    label: 'Refuted',
    banner: 'Refuted — the apparent outage does not hold',
    gloss: 'Thermal went quiet while the site stayed lit. A heat-only monitor raises this as an outage; two instruments refuse it.',
    tone: 'refuted', rank: 0, withheld: false,
  },
  LEAD: {
    label: 'Lead',
    banner: 'Dual-confirmed lead — a reason to make a phone call, not a conclusion',
    gloss: 'Heat and light fell together. That is a shortlist entry, not an established outage: a scheduled turnaround looks identical from orbit.',
    tone: 'lead', rank: 1, withheld: false,
  },
  LIGHT_DOWN_ONLY: {
    label: 'Light down only',
    banner: 'Light down only — heat is steady',
    gloss: 'Night-time light fell while the thermal signature held. One instrument moved and the other did not, so nothing is confirmed.',
    tone: 'watch', rank: 2, withheld: false,
  },
  STEADY: {
    label: 'Steady',
    banner: 'Steady — both instruments hold',
    gloss: 'Heat and light are both within this complex’s own baseline. Nothing here asks for attention.',
    tone: 'steady', rank: 3, withheld: false,
  },
  VOID_NOT_OBSERVED: {
    label: 'Not observed',
    banner: 'Withheld — not observed',
    gloss: 'No usable clear look in the window. Not dark: not seen. Absence of an observation is never a measurement.',
    tone: 'void', rank: 4, withheld: true,
  },
  VOID_INSUFFICIENT_NIGHTS: {
    label: 'Insufficient nights',
    banner: 'Withheld — too few nights to judge',
    gloss: 'Below the night floors (5 baseline, 3 window), or both instruments down on a baseline too short for the stability test. Either way no verdict is possible.',
    tone: 'void', rank: 5, withheld: true,
  },
  VOID_BASELINE_UNSTABLE: {
    label: 'Baseline unstable',
    banner: 'Withheld — the baseline spans two regimes',
    gloss: 'The stability test ran and failed: the baseline is not one population, so nothing can be compared against it.',
    tone: 'void', rank: 6, withheld: true,
  },
  VOID_HEAT_NOT_OBSERVABLE: {
    label: 'Heat not observable',
    banner: 'Withheld — no thermal baseline to fall from',
    gloss: 'The baseline heat rate is at or below the observability floor, so there is no heat to lose. Reported as not observable, never as heat steady.',
    tone: 'void', rank: 7, withheld: true,
  },
};

export const HEAT_STATES: Record<string, string> = {
  HEAT_DOWN: 'Heat down',
  HEAT_STEADY: 'Heat steady',
  HEAT_NOT_OBSERVABLE: 'Heat not observable',
};

/** The board order: refuted first, lead after it, silence last, then by key. */
export function sortRows(rows: BoardRow[]): BoardRow[] {
  return [...rows].sort((a, b) => {
    const r = VERDICTS[a.verdict].rank - VERDICTS[b.verdict].rank;
    if (r !== 0) return r;
    return a.cluster_key < b.cluster_key ? -1 : a.cluster_key > b.cluster_key ? 1 : 0;
  });
}

// ─── numbers ─────────────────────────────────────────────────────────────
/**
 * One decimal, or an em dash. NEVER a 0 stand-in: a null here means the
 * measurement does not exist, and 0 is a legitimate measured radiance.
 */
export function num1(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(1);
}
export function num2(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2);
}
/** A rate as a whole percent, or an em dash. */
export function pct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v) * 100)}%`;
}

/** "07-18 → 08-17", from two ISO dates. Explicit dates, never "30-day". */
export function windowLabel(from: string, to: string): string {
  return `${from.slice(5)} → ${to.slice(5)}`;
}

/** The five funnel terms, in order, ready to render (§2.2). */
export interface FunnelStep {
  key: string; label: string; complexes: number; rows: number; note: string; hero: boolean;
}
export function funnelSteps(t: TickPayload): FunnelStep[] {
  const f = t.funnel;
  return [
    { key: 'watched', label: 'watched', complexes: f.watched.complexes, rows: f.watched.rows,
      note: 'complexes in the registry, scored this tick', hero: false },
    { key: 'observed', label: 'observed', complexes: f.observed.complexes, rows: f.observed.rows,
      note: `${t.parameters.min_baseline_nights ?? 5}+ baseline and ${t.parameters.min_window_nights ?? 3}+ window usable clear nights carrying a retrieval`, hero: false },
    { key: 'heat_observable', label: 'heat-observable', complexes: f.heat_observable.complexes, rows: f.heat_observable.rows,
      note: `baseline heat rate above ${t.parameters.heat_observable_floor ?? 0.2} — the rest have too little heat to fall from`, hero: false },
    { key: 'thermally_dark', label: 'thermally dark', complexes: f.thermally_dark.complexes, rows: f.thermally_dark.rows,
      note: `window heat rate below ${t.parameters.heat_down_ratio ?? 0.6} × baseline`, hero: false },
    { key: 'refuted', label: 'refuted', complexes: f.refuted.complexes, rows: f.refuted.rows,
      note: 'thermally dark, but the site stayed lit — the product', hero: true },
  ];
}

/** What the outcome term actually splits into. Withheld is never dropped. */
export function outcomeSplit(t: TickPayload): Array<{ key: string; label: string; complexes: number; rows: number }> {
  return [
    { key: 'refuted', label: 'refuted', complexes: t.funnel.refuted.complexes, rows: t.funnel.refuted.rows },
    { key: 'lead', label: 'lead', complexes: t.funnel.lead.complexes, rows: t.funnel.lead.rows },
    { key: 'withheld', label: 'withheld', complexes: t.funnel.withheld.complexes, rows: t.funnel.withheld.rows },
  ];
}

/**
 * The share of thermal alarms the second instrument removes. Returns null
 * when nothing was thermally dark — a zero denominator is not "0% eliminated".
 */
export function eliminationShare(t: TickPayload): number | null {
  const dark = t.funnel.thermally_dark.complexes;
  if (!dark) return null;
  return t.funnel.refuted.complexes / dark;
}

/** D-13: the one-line robustness note, or null when nothing flips. */
export function robustnessNote(t: TickPayload): string | null {
  const flips = t.robustness.not_robust ?? [];
  if (flips.length === 0) {
    return `Every verdict on this tick survives the stricter ${t.robustness.column} retrieval (px_hq_3x3 ≥ ${t.robustness.min_px_hq}).`;
  }
  const names = flips.map((f) => `${f.cluster_key} (${VERDICTS[f.verdict].label} → ${VERDICTS[f.robustness_verdict].label})`);
  return `${flips.length} verdict${flips.length === 1 ? '' : 's'} change under the stricter ${t.robustness.column} retrieval: ${names.join(', ')}. A verdict that does not hold on both retrievals is a lead, not a conclusion.`;
}

// ─── the claims line (D-7) ───────────────────────────────────────────────
export interface ClaimsLine {
  issued: number; judged: number; label: string; status: string; families: number;
}
/**
 * "n issued · n judged · skill or Calibrating", summed over the families.
 * Skill is shown ONLY when every family that has one is defined and none is
 * calibrating — otherwise the honest word is Calibrating (D-7: a family with
 * an undefined split-half skill is never promoted or suspended on it).
 */
export function claimsLine(block: WalkforwardBlock | null | undefined): ClaimsLine | null {
  if (!block || block.error || !block.families) return null;
  const fams = Object.values(block.families);
  if (fams.length === 0) return null;
  const issued = fams.reduce((s, f) => s + (f.issued ?? 0), 0);
  const judged = fams.reduce((s, f) => s + (f.judged ?? 0), 0);
  const suspended = fams.filter((f) => f.status === 'suspended').length;
  const scored = fams.filter((f) => f.status === 'scored');
  let label: string;
  let status: string;
  if (scored.length === fams.length && scored.every((f) => f.skill !== null)) {
    const mean = scored.reduce((s, f) => s + (f.skill as number), 0) / scored.length;
    label = `skill ${mean >= 0 ? '+' : ''}${mean.toFixed(3)}`;
    status = 'scored';
  } else {
    label = 'Calibrating';
    status = suspended > 0 ? 'suspended' : 'calibrating';
  }
  return { issued, judged, label, status, families: fams.length };
}

// ─── the sensor strips ───────────────────────────────────────────────────
/** A night that was not looked at is drawn as a hatched gap, never a zero. */
export const LIGHT_GAP_STATES = new Set(['NIGHT_NOT_USABLE', 'NOT_INGESTED', 'NOT_CLEAR', 'CLEAR_NO_RETRIEVAL']);
export const HEAT_GAP_STATES = new Set(['DAY_NOT_USABLE', 'NOT_INGESTED']);

export interface StripBar {
  night: string;
  phase: 'baseline' | 'window';
  /** null = nothing was measured. The bar is a hatched gap, not a zero bar. */
  value: number | null;
  gap: boolean;
  state: string;
}

export function lightStrip(nights: DrilldownNight[]): StripBar[] {
  return nights.map((n) => ({
    night: n.night,
    phase: n.phase,
    value: n.light_state === 'OBSERVED' ? n.radiance_median : null,
    gap: LIGHT_GAP_STATES.has(n.light_state),
    state: n.light_state,
  }));
}

export function heatStrip(nights: DrilldownNight[]): StripBar[] {
  return nights.map((n) => ({
    night: n.night,
    phase: n.phase,
    value: n.heat_state === 'DETECTION' ? (n.detecting_members ?? 1)
         : n.heat_state === 'NO_DETECTION' ? 0 : null,
    gap: HEAT_GAP_STATES.has(n.heat_state),
    state: n.heat_state,
  }));
}

/** The largest measured value in a strip, or null when nothing was measured. */
export function stripMax(bars: StripBar[]): number | null {
  let m: number | null = null;
  for (const b of bars) if (b.value !== null && (m === null || b.value > m)) m = b.value;
  return m;
}

/** How many nights the strip could not look at — stated, never hidden. */
export function gapCount(bars: StripBar[]): number {
  return bars.filter((b) => b.gap).length;
}

// ─── the asset switcher, with its state in the URL ───────────────────────
export const ASSETS = ['refineries', 'power', 'maritime'] as const;
export type Asset = (typeof ASSETS)[number];
export const ASSET_LABELS: Record<Asset, string> = {
  refineries: 'Refineries',
  power: 'Power',
  maritime: 'Maritime / Port',
};
export const ASSET_STATES: Record<Asset, { state: string; tone: 'live' | 'gated' | 'blocked' }> = {
  refineries: { state: 'Weekly', tone: 'live' },
  power: { state: 'In validation', tone: 'gated' },
  maritime: { state: 'Blocked', tone: 'blocked' },
};

/** Anything unrecognised falls back to the one asset that has a detector. */
export function parseAsset(v: string | null | undefined): Asset {
  const a = (v ?? '').toLowerCase();
  return (ASSETS as readonly string[]).includes(a) ? (a as Asset) : 'refineries';
}

// ─── §3.4 · the standing maintenance disclosure, VERBATIM ────────────────
// Not a temporary caveat: no free global turnaround calendar exists, and
// "down but scheduled" is the dominant real-world refutation. This string is
// asserted character-for-character by the CI unit test — do not edit it.
export const MAINTENANCE_DISCLOSURE =
  'These instruments observe heat and light, not intent. A refinery in a scheduled turnaround and one in an unplanned outage look identical from orbit. eYKON does not hold a turnaround calendar, so every row above may be either — and a dual-confirmed lead is a reason to make a phone call, not a conclusion.';

// ─── the known limits, on the board because there is no methods page ─────
export const KNOWN_LIMITS: string[] = [
  'Recall is not measured. Every figure here is a false-positive rate: the share of apparent disruptions the second instrument removes. How many genuine shutdowns the method catches is unmeasured on refineries, and no free labelled source exists that could measure it.',
  'Heat and light are different physics, not different satellites. NASA FIRMS and Black Marble VNP46A2 are both VIIRS-family and see through the same clouds, so a cloud that hides one usually hides the other.',
  'A thermal detection is a hot pixel. It is not a fire, not a strike, and not a flare stack — and its absence is not an outage.',
  'Lit is not running. Site lighting stays on through a turnaround, so a steady light rules out "the site went dark", never "the site is producing".',
  'The cadence is set by the slowest instrument. Black Marble publishes about nine days behind, so the window always ends about nine days back. Weekly is the honest maximum, not a convenience.',
  'Africa and Latin America are barely watched. Coverage is a property of the registry and the ingest boxes, not of the world.',
  'Capacity is not established for any site on this board. The provenance chain is not built, so this board says which sites to look at and never how many barrels are affected.',
];
