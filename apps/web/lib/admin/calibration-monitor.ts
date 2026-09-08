/**
 * Calibration Ledger Monitor — the shared loader (build-prompt v1.1, §4–§9).
 *
 * Two questions, one page: is the ledger FUNCTIONING (did the scorer tick,
 * did each issuer run and what did it refuse, has the instrument published
 * the window, was a night judged after its data landed) and how SKILLED is
 * it, per track, per family, over a window, on a basis.
 *
 * Rules that shaped this file, none optional:
 *   · tracks never blend — every figure is per track or per family;
 *   · skill is the relative Brier skill score 1 − Brier/(base·(1−base));
 *   · voids are excluded, never zero;
 *   · every number carries its window, its basis and its n;
 *   · absence of a row is not absence of an event — functioning is read
 *     from run records (mig 138), never inferred from side effects;
 *   · no aggregate is re-implemented here: if SQL does not produce a
 *     number, it is not on the page. What this file does is choose windows,
 *     join plans to families by the literals the issuers write, and compare
 *     SQL-produced numbers to thresholds (§9).
 *
 * Panel ① is ALWAYS whole-pipeline; the filters act on ② ③ ④ ⑤ only.
 * Every probe is isolated: a failed RPC reddens its own card and nothing else.
 */
import { createServerSupabase } from '@/lib/supabase-server';

export type Period = '7' | '30' | '90' | 'all' | 'custom';
export type Basis = 'resolved' | 'issued';
export type TrackSel = 'all' | 'house' | 'machine' | 'creator';
export type Severity = 'ok' | 'warn' | 'crit' | 'info' | 'muted';

export const TRACKS = ['house', 'machine', 'creator'] as const;
export const MAX_CUSTOM_SPAN_DAYS = 400;
export const MIN_QUOTABLE_N = 10;
const ALL_FROM = '2000-01-01T00:00:00.000Z';
const DAY = 86_400_000;

// Documented instrument lags (brief §6.3, corrected rev S): FIRMS is near-real-
// time (~1 day, worker hourly); Black Marble VNP46A2 publishes ~9 days after
// the night and its worker runs ONCE a day (~09:45 UTC), so the clock sits
// one further day behind the wall by construction — measured 10.5 d on
// 2026-09-08 with a healthy pipeline. Thresholds (§5 ①): green within
// documented + cadence + 1 d · amber + 3 d · red beyond.
const CLOCK_LAG = { firms: { doc: 1, cadence: 0 }, blackmarble: { doc: 9, cadence: 1 } } as const;

// The source literals the issuers write — verified in code, not guessed:
//   lib/predictions/issue-dark-contact.ts   source 'ais-darkgap'    feature 'ais_dark_contact_reappearance'
//   lib/predictions/issue-firms-recovery.ts source 'firms-recovery' feature 'firms_went_dark_recovery'
//   lib/predictions/issue-blackmarble.ts    source 'blackmarble'    feature 'nightlights_first_light_persistence' | 'nightlights_recovery'
// The family LIST itself is derived from the register at request time; this
// table only says which plan RPC explains which feature.
//   app/api/cron/issue-eia-weekly            source 'eia'            feature 'eia_weekly_inventory'   (Mondays 09:00 UTC)
//   app/api/cron/issue-chokepoint-weekly     source 'ais'            feature 'ais_chokepoint_weekly'  (Mondays 09:00 UTC)
export const ISSUER_SOURCES = ['ais-darkgap', 'firms-recovery', 'blackmarble', 'eia', 'ais'] as const;
type IssuerSource = (typeof ISSUER_SOURCES)[number];
// Railway schedules as set by the founder, and the ages at which a missing
// run row is a warning / a fault. Hourly issuers: 2 h / 4 h. Daily (after the
// 10:05 UTC judgement): 2 d / 4 d. Weekly (Mondays 09:00 UTC): a week and a
// day / two weeks — a Monday that never fired is visible by Tuesday.
// `silent_h` is the window in which an eligible family must have issued
// something for issuance-silent to stay quiet — a weekly issuer is not silent
// on a Thursday.
const ISSUER_CADENCE: Record<IssuerSource, { schedule: string; warn_h: number; crit_h: number; silent_h: number }> = {
  'ais-darkgap':    { schedule: 'hourly',              warn_h: 2,   crit_h: 4,   silent_h: 24 },
  'firms-recovery': { schedule: 'hourly',              warn_h: 2,   crit_h: 4,   silent_h: 24 },
  blackmarble:      { schedule: 'daily ~10:24 UTC',    warn_h: 48,  crit_h: 96,  silent_h: 48 },
  eia:              { schedule: 'Mondays 09:00 UTC',   warn_h: 192, crit_h: 336, silent_h: 192 },
  ais:              { schedule: 'Mondays 09:00 UTC',   warn_h: 192, crit_h: 336, silent_h: 192 },
};

export interface Filters {
  period: Period;
  basis: Basis;
  track: TrackSel;
  family: string; // feature literal or 'all'
  from: string; // ISO — the window applied to the basis timestamp
  to: string;
  days: number;
  label: string; // '30d' · 'all' · '2026-08-25 → 2026-09-08'
}

type SP = URLSearchParams | Record<string, string | string[] | undefined>;
function pick(sp: SP, k: string): string | null {
  if (sp instanceof URLSearchParams) return sp.get(k);
  const v = sp[k];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}
function isoDate(s: string | null): string | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
}

/** Filters are URL search params so a view can be linked and reproduced (§4). */
export function parseFilters(sp: SP, now: Date = new Date()): Filters {
  const p = pick(sp, 'period');
  const period: Period = p === '7' || p === '90' || p === 'all' || p === 'custom' ? p : '30';
  const basis: Basis = pick(sp, 'basis') === 'issued' ? 'issued' : 'resolved';
  const t = pick(sp, 'track');
  const track: TrackSel = t === 'house' || t === 'machine' || t === 'creator' ? t : 'all';
  const fam = (pick(sp, 'family') ?? 'all').trim();
  const family = /^[a-z0-9_]{1,64}$/.test(fam) ? fam : 'all';
  const toMs = now.getTime() + 60_000; // include rows written this minute

  if (period === 'custom') {
    const f = isoDate(pick(sp, 'from'));
    const tt = isoDate(pick(sp, 'to'));
    const to = tt ? Math.min(Date.parse(`${tt}T23:59:59.999Z`), toMs) : toMs;
    let from = f ? Date.parse(`${f}T00:00:00Z`) : to - 30 * DAY;
    if (from >= to) from = to - DAY;
    if (to - from > MAX_CUSTOM_SPAN_DAYS * DAY) from = to - MAX_CUSTOM_SPAN_DAYS * DAY;
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to).toISOString();
    return {
      period, basis, track, family, from: fromIso, to: toIso,
      days: Math.max(1, Math.ceil((to - from) / DAY)),
      label: `${fromIso.slice(0, 10)} → ${toIso.slice(0, 10)}`,
    };
  }
  if (period === 'all') {
    return { period, basis, track, family, from: ALL_FROM, to: new Date(toMs).toISOString(), days: MAX_CUSTOM_SPAN_DAYS, label: 'all' };
  }
  const days = Number(period);
  return {
    period, basis, track, family,
    from: new Date(toMs - days * DAY).toISOString(), to: new Date(toMs).toISOString(),
    days, label: `${days}d`,
  };
}

// ─── payload shapes (what the SQL of migs 124–138 returns) ─────────────

export interface Bin { bin: number; predicted: number; n: number; observed: number | null }
export interface TrackStats {
  resolved: number; scored: number; void: number;
  brier: number | null; log_loss: number | null; base_rate: number | null; sharpness: number | null; skill: number | null;
  reliability?: Bin[] | null;
}
export interface FamilyStats extends TrackStats { track: string; feature: string }
export interface WindowStats { basis: Basis; from: string; to: string; tracks: Record<string, TrackStats>; families: FamilyStats[] }

export interface Cohort {
  day: string; issued: number; n: number; open: number; complete: boolean;
  brier: number | null; base_rate: number | null; sharpness: number | null; skill: number | null;
}
export interface BoxCohort extends Cohort { box: string; void: number }
export interface Change { at: string; pr: string; note: string }
export interface CohortsPayload { days: number; tracks: Record<string, Cohort[]>; changes: Change[] }

export interface ScorerRun {
  ran_at: string; candidates: number; scored: number; deferred: number; voided: number;
  limit: number | null; selection: string | null; due_unscored: number | null; ok: boolean; error: string | null;
}
export interface IngestRun {
  night: string; tiles_expected: number; tiles_processed: number; tiles_missing: number;
  facilities_written: number; ok: boolean; error: string | null; ran_at: string;
}
export interface IssuanceRun {
  source: string; ran_at: string; issued: number; already_present: number | null;
  declined: Record<string, number> | null; error: string | null;
}
export interface FamilyRow { track: string; feature: string; source: string | null; issued: number; newest: string }
export interface Health {
  generated_at: string;
  scorer: ScorerRun | null;
  queue: { due: number | null; by_source: { source: string; n: number; oldest_due: string }[] };
  clocks: { firms: string | null; blackmarble: string | null; ais: string | null };
  blackmarble_newest_night: IngestRun | null;
  blackmarble_last_run: IngestRun | null;
  blackmarble_roster: number | null;
  firms_ingest: { last_run: string | null; ok_6h: number; failed_6h: number };
  detect_runs: { night: string; events: number; judged_at: string; duration_ms: number | null }[];
  firms_events_newest: string | null;
  detect_runs_since: string | null;
  rejudge_needed: string[];
  boxes: { slug: string; kind: string; silent_hours: number | null; vessels: number | null; fixes_last_hour: number | null }[];
  boxes_computed_at: string | null;
  issuance_24h: { source: string; issued: number }[];
  issuance_runs: IssuanceRun[];
  integrity: Record<string, { issued: number; scored: number; void: number; pending: number; missing_hash: number; sealed: number; reconciles: boolean }>;
  judged_unpublished: number;
  source_check: string | null;
  sources_in_use: string[];
  families: FamilyRow[];
}
export interface CronJob { schedule: string; active: boolean; runs: { status: string; start: string; secs: number | null; message: string | null }[] }

export interface PlanBox { k: number; n: number; rate: number; eligible: boolean; reason: string | null; issued_today: number; remaining: number }
export interface DarkgapPlan { rule: { band_lo: number; band_hi: number; min_n: number; daily_cap_per_box: number }; boxes: Record<string, PlanBox> }
export interface FirmsPlan {
  horizon_days: number; family: { n: number; base_rate: number; eligible: boolean; band_lo: number; band_hi: number };
  daily_cap: number; issued_today: number; remaining: number; rule: string;
}
export interface BlackmarbleFamily { n: number; base_rate: number; eligible: boolean; reason: string | null; issued_today: number; remaining: number }
export interface BlackmarblePlan {
  horizon_days: number; data_clock: string | null; daily_cap: number; rule: string; families: Record<string, BlackmarbleFamily>;
  // mig 142: the record is cached and refreshed hourly by pg_cron; the quota and clock are live
  computed_at?: string | null; computed_on?: string | null; compute_ms?: number | null; cache?: 'hit' | 'miss'; cache_age_s?: number | null; stale?: boolean;
}
export interface EiaPlan {
  as_of?: string; basis?: string; current_cell?: string; forecast?: number | null; eligible?: boolean; n?: number;
  base_rate?: number; rate?: number; note?: string;
  // mig 129 nests the walk-forward evidence
  evidence?: { walk_forward_n?: number; skill_this_model?: number | null; skill_momentum?: number | null; skill_base_rate?: number | null; note?: string };
}
export interface HouseGate {
  n: number; base_rate: number; mean_forecast: number; brier: number; prior: number; prior_basis: string;
  recal_applied: boolean; recal_shift: number;
  recal_evidence: Record<string, { skill_now: number | null; skill_recal: number | null; helps: boolean }>;
}
export interface LedgerTracks {
  tracks: Record<string, { issued?: number; resolved?: number; void?: number; open?: number; headline: { brier: number; skill: number | null; base_rate: number; log_loss?: number } | null }>;
}
export interface WatchItem {
  id: number; due_at: string | null; text: string; seen_at: string | null; created_at: string;
  // mig 147: a fixed-kind predicate that proves the item, and what proved it
  proof: Record<string, unknown> | null; evidence: Record<string, unknown> | null; checked_at: string | null;
}
/** The proof kinds ledger_watch_prove() understands (mig 147) — a closed list, never free SQL. */
export const WATCH_PROOF_KINDS = {
  outcome_exists:             { label: 'an outcome exists for a source',            params: ['source'] },
  family_scored_n:            { label: 'a family reaches n scored claims',          params: ['feature', 'min_n'] },
  cohort_complete:            { label: 'an issuance cohort is complete',            params: ['track', 'day'] },
  nights_judged_after_ingest: { label: 'nights judged after their newest ingest',   params: ['nights'] },
  issuance_run_exists:        { label: 'an issuer has recorded a tick',             params: ['source'] },
  alert_cleared:              { label: 'an alert has cleared',                      params: ['alert_id'] },
  scorer_voided:              { label: 'a scorer tick voided claims',               params: ['min_voided'] },
} as const;
export type WatchProofKind = keyof typeof WATCH_PROOF_KINDS;
const SLUG = /^[a-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Validate a proof from the founder's form. Returns null when absent or malformed (the caller decides). */
export function sanitizeProof(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const kind = String(o.kind ?? '');
  if (!(kind in WATCH_PROOF_KINDS)) return null;
  const out: Record<string, unknown> = { kind };
  const str = (k: string) => { const v = String(o[k] ?? '').trim(); return SLUG.test(v) ? v : null; };
  const int = (k: string, dflt: number) => { const v = Number(o[k]); return Number.isInteger(v) && v > 0 && v < 1_000_000 ? v : dflt; };
  switch (kind as WatchProofKind) {
    case 'outcome_exists': case 'issuance_run_exists': { const s = str('source'); if (!s) return null; out.source = s; if (kind === 'outcome_exists') out.min_n = int('min_n', 1); break; }
    case 'family_scored_n': { const f = str('feature'); if (!f) return null; out.feature = f; out.min_n = int('min_n', 10); break; }
    case 'cohort_complete': { const t = str('track'); const d = String(o.day ?? '').trim(); if (!t || !DAY_RE.test(d)) return null; out.track = t; out.day = d; break; }
    case 'nights_judged_after_ingest': { const raw = Array.isArray(o.nights) ? o.nights : String(o.nights ?? '').split(','); const nights = raw.map((v) => String(v).trim()).filter((v) => DAY_RE.test(v)); if (!nights.length) return null; out.nights = nights; break; }
    case 'alert_cleared': { const a = str('alert_id'); if (!a) return null; out.alert_id = a; break; }
    case 'scorer_voided': { out.min_voided = int('min_voided', 1); break; }
  }
  return out;
}

export interface Probe<T> { data: T | null; error: string | null; as_of: string }
export interface Alert { id: string; severity: Severity; text: string; rule: string; evaluated_at: string; since?: string | null }
export interface AlertState { alert_id: string; severity: 'warn' | 'crit'; text: string; rule: string | null; first_fired_at: string; last_seen_at: string; last_notified_at: string | null }
export interface AlertEvent { id: number; alert_id: string; transition: string; severity: string; text: string; at: string; notified: boolean }

/** The plan that explains a family, joined by the issuer's feature literal. */
export interface FamilyPlan {
  base_rate: number | null; n: number | null; eligible: boolean | null; band: string | null;
  issued_today: number | null; cap: number | null; reason: string | null; state: string; source_rpc: string;
}
export interface FamilyView extends FamilyRow { plan: FamilyPlan | null }
export interface Agreement { track: string; brier_stats: number | null; brier_ledger: number | null; skill_stats: number | null; skill_ledger: number | null; agree: boolean }

export interface Monitor {
  generated_at: string;
  filters: Filters;
  health: Probe<Health>;
  cron: Probe<Record<string, CronJob>>;
  plans: {
    darkgap: Probe<DarkgapPlan>; firms: Probe<FirmsPlan>; blackmarble: Probe<BlackmarblePlan>;
    eia: Probe<EiaPlan>; house: Probe<Record<string, HouseGate>>;
  };
  window: Probe<WindowStats>;
  matrix: Record<'7' | '30' | '90' | 'all', Probe<WindowStats>>;
  ledger: Probe<LedgerTracks>;
  cohorts: Probe<CohortsPayload>;
  boxCohorts: Probe<BoxCohort[]>;
  watch: Probe<WatchItem[]>;
  alertState: Probe<AlertState[]>;
  alertEvents: Probe<AlertEvent[]>;
  families: FamilyView[];
  agreement: Agreement[];
  alerts: Alert[];
}
export interface AlertInputs { health: Probe<Health>; cron: Probe<Record<string, CronJob>>; plans: Monitor['plans']; families: FamilyView[] }

async function probe<T>(fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Probe<T>> {
  const as_of = new Date().toISOString();
  try {
    const { data, error } = await fn();
    return { data: error ? null : (data as T), error: error ? error.message : null, as_of };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e), as_of };
  }
}

const hoursSince = (iso: string | null | undefined, now: Date): number | null =>
  iso ? (now.getTime() - Date.parse(iso)) / 3_600_000 : null;
const daysSinceDate = (d: string | null | undefined, now: Date): number | null =>
  d ? (now.getTime() - Date.parse(`${d}T00:00:00Z`)) / DAY : null;

function planFor(row: FamilyRow, plans: Monitor['plans']): FamilyPlan | null {
  const dg = plans.darkgap.data, fp = plans.firms.data, bp = plans.blackmarble.data, ep = plans.eia.data, hg = plans.house.data;
  switch (row.feature) {
    case 'ais_dark_contact_reappearance': {
      if (!dg?.boxes) return null;
      const boxes = Object.values(dg.boxes);
      const elig = boxes.filter((b) => b.eligible);
      const rates = elig.map((b) => b.rate).sort((a, b) => a - b);
      return {
        base_rate: null, n: Math.max(0, ...boxes.map((b) => b.n)), eligible: elig.length > 0,
        band: `${dg.rule.band_lo}–${dg.rule.band_hi} per box`,
        issued_today: boxes.reduce((s, b) => s + (b.issued_today ?? 0), 0),
        cap: elig.length * dg.rule.daily_cap_per_box,
        reason: rates.length ? `rates ${rates[0].toFixed(3)}–${rates[rates.length - 1].toFixed(3)} over ${elig.length}/${boxes.length} eligible boxes` : 'no eligible box',
        state: elig.length ? `${elig.length} boxes issuing` : 'no box eligible', source_rpc: 'dark_contact_issuance_plan() · mig 125',
      };
    }
    case 'firms_went_dark_recovery':
      if (!fp?.family) return null;
      return {
        base_rate: fp.family.base_rate, n: fp.family.n, eligible: fp.family.eligible,
        band: `${fp.family.band_lo}–${fp.family.band_hi}`, issued_today: fp.issued_today, cap: fp.daily_cap,
        reason: null, state: fp.family.eligible ? 'issuing' : 'not eligible', source_rpc: 'firms_recovery_plan() · mig 127',
      };
    case 'nightlights_first_light_persistence':
    case 'nightlights_recovery': {
      const key = row.feature === 'nightlights_recovery' ? 'went_dark_lights' : 'first_light';
      const fam = bp?.families?.[key];
      if (!fam) return null;
      return {
        base_rate: fam.base_rate, n: fam.n, eligible: fam.eligible, band: '0.20–0.80', issued_today: fam.issued_today, cap: bp?.daily_cap ?? null,
        reason: fam.reason, state: fam.eligible ? 'issuing' : (fam.reason ?? 'not eligible'), source_rpc: `blackmarble_claim_plan().families.${key} · mig 128`,
      };
    }
    case 'eia_weekly_inventory': {
      if (!ep) return null;
      const cell = ep.current_cell ?? '—';
      return {
        base_rate: ep.base_rate ?? ep.rate ?? null, n: ep.n ?? null, eligible: ep.eligible ?? null, band: null,
        issued_today: null, cap: null, reason: ep.note ?? null,
        state: ep.forecast != null ? `cell ${cell} → ${Number(ep.forecast).toFixed(3)}` : `cell ${cell}`, source_rpc: 'eia_draw_plan() · mig 129',
      };
    }
    default: {
      const g = hg?.[row.feature];
      if (!g) return null;
      return {
        base_rate: g.base_rate, n: g.n, eligible: null, band: null, issued_today: null, cap: null, reason: g.prior_basis,
        state: `prior ${g.prior.toFixed(4)} · recal ${g.recal_applied ? 'ON' : 'OFF'}`, source_rpc: 'house_family_calibration() · mig 126',
      };
    }
  }
}

/** §9 — the rules, as code. Each names its source, its threshold and when it was evaluated. */
export function evaluateAlerts(m: Pick<Monitor, 'health' | 'cron' | 'plans' | 'families'>, now: Date): Alert[] {
  const at = now.toISOString();
  const out: Alert[] = [];
  const add = (id: string, severity: Severity, text: string, rule: string) => out.push({ id, severity, text, rule, evaluated_at: at });
  const h = m.health.data;
  if (!h) {
    add('health-probe', 'crit', `calibration_monitor_health() failed: ${m.health.error ?? 'no data'}`, 'the health probe itself');
    return out;
  }

  // scorer-stale · score_predictions_runs · amber > 2 h · red > 6 h or ok=false
  const scorerH = hoursSince(h.scorer?.ran_at, now);
  if (!h.scorer) add('scorer-stale', 'warn', 'No scorer run record yet — the first score-predictions tick after migration 138 writes one (hourly at :07).', 'score_predictions_runs empty');
  else if (!h.scorer.ok) add('scorer-stale', 'crit', `Last scorer tick reported ok=false: ${h.scorer.error ?? 'no error text'}.`, 'score_predictions_runs.ok = false');
  else if (scorerH !== null && scorerH > 6) add('scorer-stale', 'crit', `Scorer silent ${scorerH.toFixed(1)} h (last tick ${h.scorer.ran_at}); schedule is hourly at :07.`, 'now − last run > 6 h');
  else if (scorerH !== null && scorerH > 2) add('scorer-stale', 'warn', `Scorer silent ${scorerH.toFixed(1)} h (last tick ${h.scorer.ran_at}); schedule is hourly at :07.`, 'now − last run > 2 h');
  else add('scorer-stale', 'ok', `Scorer tick ${scorerH === null ? '—' : `${Math.round(scorerH * 60)} min ago`}: ${h.scorer.candidates} candidates · ${h.scorer.scored} scored · ${h.scorer.deferred} deferred · ${h.scorer.voided} void.`, 'now − last run ≤ 2 h');

  // judged-unpublished · outcomes ⋈ register ⋈ clocks · red
  if (h.judged_unpublished > 0) add('judged-unpublished', 'crit', `${h.judged_unpublished} outcome(s) judged on a window the instrument had not published — the #482 rule is being bypassed.`, 'claim window end ≥ instrument data clock');
  else add('judged-unpublished', 'ok', 'No outcome judged on an unpublished window (data-clock guard #482 holding).', 'claim window end ≥ instrument data clock → 0 rows');

  // due-unresolvable · register · amber
  const stale = (h.queue.by_source ?? []).filter((q) => (daysSinceDate(q.oldest_due.slice(0, 10), now) ?? 0) > 30);
  if (stale.length) add('due-unresolvable', 'warn', stale.map((q) => `${q.source}: ${q.n} due, oldest ${q.oldest_due.slice(0, 10)}`).join(' · ') + ' — older than 30 d with no resolver path; void as unresolvable or resolve by hand.', 'a source with due claims older than 30 d');
  else add('due-unresolvable', 'ok', `${h.queue.due ?? 0} due, none older than 30 d.`, 'due claims older than 30 d → none');
  if ((h.queue.due ?? 0) > 0 && scorerH !== null && scorerH > 6) add('due-queue', 'crit', `${h.queue.due} claims due and no scorer tick in ${scorerH.toFixed(1)} h.`, 'due > 0 ∧ no tick in 6 h');

  // clock-stalled · clocks · amber documented+1 d · red documented+3 d
  const lagF = daysSinceDate(h.clocks.firms, now), lagB = daysSinceDate(h.clocks.blackmarble, now), aisH = hoursSince(h.clocks.ais, now);
  const clockText = (name: string, lag: number | null, c: { doc: number; cadence: number }) =>
    `${name} ${lag === null ? 'never' : `${lag.toFixed(1)} d behind wall`} (documented ~${c.doc} d${c.cadence ? ` + ${c.cadence} d worker cadence` : ''})`;
  const worstClock = (lag: number | null, c: { doc: number; cadence: number }): Severity =>
    lag === null || lag > c.doc + c.cadence + 3 ? 'crit' : lag > c.doc + c.cadence + 1 ? 'warn' : 'ok';
  const cf = worstClock(lagF, CLOCK_LAG.firms), cb = worstClock(lagB, CLOCK_LAG.blackmarble);
  const ca: Severity = aisH === null || aisH > 6 ? 'crit' : aisH > 2 ? 'warn' : 'ok';
  const clockSev: Severity = [cf, cb, ca].includes('crit') ? 'crit' : [cf, cb, ca].includes('warn') ? 'warn' : 'ok';
  add('clock-stalled', clockSev, `${clockText('FIRMS', lagF, CLOCK_LAG.firms)} · ${clockText('Black Marble', lagB, CLOCK_LAG.blackmarble)} · AIS newest fix ${aisH === null ? 'never' : `${aisH.toFixed(1)} h ago`}.`, 'data clock behind documented lag + worker cadence + 1 d (amber) / + 3 d (red); AIS > 2 h / 6 h');

  // partial-night · blackmarble_ingest_runs vs roster · red
  const nn = h.blackmarble_newest_night, roster = h.blackmarble_roster ?? 0;
  if (nn && roster > 0 && nn.facilities_written < roster * 0.5) add('partial-night', 'crit', `Newest Black Marble night ${nn.night} wrote ${nn.facilities_written.toLocaleString()} facilities of a ${roster.toLocaleString()} roster (${nn.tiles_processed}/${nn.tiles_expected} tiles).`, 'newest night facilities_written < 50 % roster');
  else if (nn) add('partial-night', 'ok', `Newest Black Marble night ${nn.night}: ${nn.facilities_written.toLocaleString()} facilities, ${nn.tiles_processed}/${nn.tiles_expected} tiles.`, 'newest night facilities_written ≥ 50 % roster');

  // detect-behind · nightlights_detect_runs · red after 10:30 UTC (or ≥ 2 nights behind at any hour)
  const newestJudged = h.detect_runs?.[0]?.night ?? null;
  const clockB = h.clocks.blackmarble;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (clockB && newestJudged && clockB > newestJudged) {
    const gap = (Date.parse(`${clockB}T00:00:00Z`) - Date.parse(`${newestJudged}T00:00:00Z`)) / DAY;
    if (utcMin >= 10 * 60 + 30 || gap >= 2) add('detect-behind', 'crit', `Data clock ${clockB} is ahead of the newest judged night ${newestJudged} (${gap} night(s)); detect-nightlights runs 10:05 UTC.`, 'data clock > newest judged night after 10:30 UTC');
    else add('detect-behind', 'info', `Data clock ${clockB} ahead of newest judged night ${newestJudged}; the 10:05 UTC job has not run yet today.`, 'data clock > newest judged night, before 10:30 UTC');
  } else if (!newestJudged) add('detect-behind', 'crit', 'No night has ever been judged (nightlights_detect_runs is empty).', 'nightlights_detect_runs empty');
  else add('detect-behind', 'ok', `Newest judged night ${newestJudged} = data clock ${clockB ?? '—'}.`, 'data clock ≤ newest judged night');

  // detect-rejudge · ingest runs ⋈ detect runs · amber
  if (h.rejudge_needed?.length) add('detect-rejudge', 'warn', `Night(s) ${h.rejudge_needed.join(', ')} were re-ingested after they were judged — re-judge needed (nightlights_detect_recent), or the job must re-judge refilled nights.`, 'a night whose ingest run is newer than its detect run');
  else add('detect-rejudge', 'ok', `Every night since ${h.detect_runs_since ?? '—'} (run records began) was judged after its newest ingest run.`, 'ingest run newer than detect run → none');

  // detect-slow · nightlights_detect_runs · amber
  const slow = (h.detect_runs ?? []).filter((d) => (d.duration_ms ?? 0) > 2000);
  if (slow.length) add('detect-slow', 'warn', slow.map((d) => `${d.night} ${d.duration_ms} ms`).join(' · ') + ' — over the 2,000 ms budget (the cold-cache plan, mig 134).', 'any judged night > 2,000 ms');
  else add('detect-slow', 'ok', `Recent judgements ${(h.detect_runs ?? []).slice(0, 3).map((d) => `${d.night} ${d.duration_ms ?? '—'} ms`).join(' · ') || '—'}.`, 'judged nights ≤ 2,000 ms');

  // pg_cron job failures (detect-nightlights, refresh-vessel-cadence)
  const cron = m.cron.data ?? {};
  for (const [job, j] of Object.entries(cron)) {
    const last = j.runs?.[0];
    if (!j.active) add(`cron-${job}`, 'crit', `pg_cron job ${job} is INACTIVE.`, 'cron.job.active = false');
    else if (last && last.status !== 'succeeded') add(`cron-${job}`, 'crit', `pg_cron job ${job} last run ${last.status} at ${last.start}: ${last.message ?? ''}`, 'cron.job_run_details.status ≠ succeeded');
  }

  // issuance-silent · plans + issuance_runs · amber
  const lastRun = new Map((h.issuance_runs ?? []).map((r) => [r.source, r]));
  for (const fam of m.families) {
    if (!fam.source || !(ISSUER_SOURCES as readonly string[]).includes(fam.source)) continue;
    const cadence = ISSUER_CADENCE[fam.source as IssuerSource];
    const run = lastRun.get(fam.source);
    const candidates = run ? (run.already_present ?? 0) + Object.values(run.declined ?? {}).reduce((s, v) => s + (Number(v) || 0), 0) + run.issued : 0;
    const sinceIssuedH = hoursSince(fam.newest, now);
    if (fam.plan?.eligible && sinceIssuedH !== null && sinceIssuedH > cadence.silent_h && run && candidates > 0) {
      add(`issuance-silent:${fam.feature}`, 'warn', `${fam.feature} is eligible but has issued nothing for ${(sinceIssuedH / 24).toFixed(1)} d (window ${cadence.silent_h} h for a ${cadence.schedule} issuer) while its last tick saw ${candidates} candidates (declined ${JSON.stringify(run.declined ?? {})}).`, `eligible family issued nothing in ${cadence.silent_h} h with candidates > 0`);
    }
  }
  // issuance-stale · issuance_runs · amber at 2× the schedule, red at 4× — a tick
  // that dies before its issuing block writes no row, so age is the only signal
  for (const src of ISSUER_SOURCES) {
    const run = lastRun.get(src);
    const cadence = ISSUER_CADENCE[src];
    const age = hoursSince(run?.ran_at, now);
    if (!run) add(`issuance-stale:${src}`, 'info', `${src}: no issuance run record yet — the first tick (${cadence.schedule}) after its run-record release writes one.`, 'issuance_runs has no row for this source');
    else if (age !== null && age > cadence.crit_h) add(`issuance-stale:${src}`, 'crit', `${src} issuer silent ${(age / 24).toFixed(1)} d (${cadence.schedule}) — the tick is dying before it issues, or the cron is off.`, `now − last run > ${cadence.crit_h} h`);
    else if (age !== null && age > cadence.warn_h) add(`issuance-stale:${src}`, 'warn', `${src} issuer silent ${age.toFixed(1)} h (${cadence.schedule}).`, `now − last run > ${cadence.warn_h} h`);
  }
  // issuance-error · issuance_runs · red
  for (const r of h.issuance_runs ?? []) {
    if (r.error) add(`issuance-error:${r.source}`, 'crit', `${r.source} last issuing tick (${r.ran_at}) reported: ${r.error}`, 'error non-null on last issuing tick');
  }
  if (!out.some((a) => a.id.startsWith('issuance-') && a.severity !== 'info')) add('issuance', 'ok', (h.issuance_24h ?? []).map((i) => `${i.source} ${i.issued.toLocaleString()}`).join(' · ') || 'nothing issued in 24 h', 'no eligible family silent, no issuer error');

  // plan-stale · blackmarble_claim_plan_cache (mig 142) · amber — the record the
  // night-lights issuer and the public ledger read must have been refreshed
  const bp = m.plans.blackmarble.data;
  if (m.plans.blackmarble.error) add('plan-stale', 'warn', `blackmarble plan probe failed: ${m.plans.blackmarble.error}`, 'blackmarble_claim_plan() errored');
  else if (bp && bp.cache === 'miss') add('plan-stale', 'warn', 'blackmarble plan served by live computation — no cache row for the default parameters (refresh-blackmarble-plan has not run since migration 142).', 'blackmarble_claim_plan_cache miss');
  else if (bp && bp.stale) add('plan-stale', 'warn', `blackmarble plan cache is ${((bp.cache_age_s ?? 0) / 3600).toFixed(1)} h old (computed ${bp.computed_at}) — refresh-blackmarble-plan (hourly at :12) is not running.`, 'cache older than 26 h');
  else if (bp && bp.computed_at) add('plan-stale', 'ok', `blackmarble plan computed ${bp.computed_at.slice(0, 16).replace('T', ' ')} UTC in ${bp.compute_ms ?? '—'} ms, on data clock ${bp.computed_on ?? '—'} (cache hit).`, 'cache younger than 26 h');

  // box-dark · ais_box_liveness · amber per dark box
  const dark = (h.boxes ?? []).filter((b) => b.silent_hours === null || b.silent_hours > 24);
  if (dark.length) add('box-dark', 'warn', dark.map((b) => `${b.slug} silent ${b.silent_hours === null ? 'always' : `${(b.silent_hours / 24).toFixed(1)} d`}`).join(' · ') + ' — a coverage hole, not darkness; claims there VOID by the dead-box gate (mig 110).', 'AIS box newest_fix > 24 h');
  else add('box-dark', 'ok', `All ${(h.boxes ?? []).length} AIS boxes heard from within 24 h.`, 'AIS box newest_fix > 24 h → none');

  // worker-empty-ok · blackmarble_ingest_runs · amber
  const lr = h.blackmarble_last_run;
  if (lr && lr.ok && lr.tiles_processed > 0 && lr.facilities_written === 0) add('worker-empty-ok', 'warn', `Black Marble run for ${lr.night} processed ${lr.tiles_processed} tiles, wrote 0 facilities, and reported ok — the #480 defect shape.`, 'ok=true ∧ tiles_processed>0 ∧ facilities_written=0');
  else if (lr && !lr.ok) add('worker-empty-ok', 'crit', `Black Marble last run (${lr.night}) failed: ${lr.error ?? 'no error text'}.`, 'ingest run ok=false');
  else if (lr) add('worker-empty-ok', 'ok', `Black Marble last run ${lr.ran_at.slice(0, 16).replace('T', ' ')} UTC · night ${lr.night} · ${lr.tiles_processed}/${lr.tiles_expected} tiles · ${lr.facilities_written.toLocaleString()} facilities.`, 'ok ∧ facilities_written > 0');

  // integrity · register/outcomes · red
  const bad = Object.entries(h.integrity ?? {}).filter(([, t]) => t.missing_hash > 0 || !t.reconciles);
  if (bad.length) add('integrity', 'crit', bad.map(([t, v]) => `${t}: ${v.missing_hash} rows without hash · ${v.issued} issued vs ${v.scored}+${v.void}+${v.pending}`).join(' · '), 'rows without hash > 0, or issued ≠ scored + void + pending');
  else add('integrity', 'ok', Object.entries(h.integrity ?? {}).map(([t, v]) => `${t} ${v.issued.toLocaleString()} = ${v.scored.toLocaleString()} + ${v.void} + ${v.pending.toLocaleString()}`).join(' · '), 'every row hashed; issued = scored + void + pending');

  // check-mismatch · pg_constraint vs the literals the issuers write · red
  const admitted = new Set(Array.from((h.source_check ?? '').matchAll(/'([^']+)'/g)).map((x) => x[1]));
  const wanted = new Set<string>([...ISSUER_SOURCES, ...(h.sources_in_use ?? []).filter(Boolean)]);
  const missing = h.source_check ? Array.from(wanted).filter((s) => !admitted.has(s)) : [];
  if (!h.source_check) add('check-mismatch', 'warn', 'predictions_register_source_check not found — the register would accept any source literal.', 'pg_constraint row absent');
  else if (missing.length) add('check-mismatch', 'crit', `Source literal(s) not admitted by predictions_register_source_check: ${missing.join(', ')} (the mig 113/133 failure).`, "issuer's source literal ∉ CHECK");
  else add('check-mismatch', 'ok', `CHECK admits every issuer literal (${Array.from(admitted).join(', ')}).`, 'issuer source literals ⊆ CHECK');

  // family plans: a family that issued in the last day but is not eligible today, for a reason other than the band
  for (const fam of m.families) {
    const recent = (daysSinceDate(fam.newest.slice(0, 10), now) ?? 99) <= 1;
    if (fam.plan && fam.plan.eligible === false && recent && !(fam.plan.reason ?? '').includes('band')) {
      add(`plan-ineligible:${fam.feature}`, 'crit', `${fam.feature} issued within a day but its plan is not eligible today (${fam.plan.reason ?? 'no reason given'}).`, 'issued yesterday ∧ not eligible today ∧ reason ≠ outside band');
    }
  }

  const rank: Record<Severity, number> = { crit: 0, warn: 1, info: 2, ok: 3, muted: 4 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * The probes the alert rules read — ① and the plans. Shared by the page and
 * the hourly evaluator (lib/admin/ledger-alerts.ts), so both see the same facts.
 */
export async function probeAlertInputs(supabase: ReturnType<typeof createServerSupabase>): Promise<AlertInputs> {
  const [health, cron, darkgap, firms, blackmarble, eia, house] = await Promise.all([
    probe<Health>(() => supabase.rpc('calibration_monitor_health')),
    probe<Record<string, CronJob>>(() => supabase.rpc('pg_cron_recent_runs', { p_jobs: ['refresh-vessel-cadence', 'detect-nightlights', 'refresh-blackmarble-plan'], p_limit: 5 })),
    probe<DarkgapPlan>(() => supabase.rpc('dark_contact_issuance_plan')),
    probe<FirmsPlan>(() => supabase.rpc('firms_recovery_plan')),
    probe<BlackmarblePlan>(() => supabase.rpc('blackmarble_claim_plan')),
    probe<EiaPlan>(() => supabase.rpc('eia_draw_plan')),
    probe<Record<string, HouseGate>>(() => supabase.rpc('house_family_calibration')),
  ]);
  const plans = { darkgap, firms, blackmarble, eia, house };
  const families: FamilyView[] = (health.data?.families ?? []).map((r) => ({ ...r, plan: planFor(r, plans) }));
  return { health, cron, plans, families };
}

export async function loadMonitor(f: Filters, now: Date = new Date()): Promise<Monitor> {
  const supabase = createServerSupabase();
  const toIso = new Date(now.getTime() + 60_000).toISOString();
  const ago = (d: number) => new Date(now.getTime() + 60_000 - d * DAY).toISOString();
  const stats = (from: string, to: string, basis: Basis, track: string | null, feature: string | null) =>
    probe<WindowStats>(() => supabase.rpc('calibration_family_stats', { p_from: from, p_to: to, p_basis: basis, p_track: track, p_feature: feature }));

  const [inputs, window, m7, m30, m90, mAll, ledger, cohorts, boxCohorts, watch, alertState, alertEvents] = await Promise.all([
    probeAlertInputs(supabase),
    stats(f.from, f.to, f.basis, f.track === 'all' ? null : f.track, f.family === 'all' ? null : f.family),
    stats(ago(7), toIso, 'resolved', null, null),
    stats(ago(30), toIso, 'resolved', null, null),
    stats(ago(90), toIso, 'resolved', null, null),
    stats(ALL_FROM, toIso, 'resolved', null, null),
    probe<LedgerTracks>(() => supabase.rpc('calibration_ledger_tracks')),
    probe<CohortsPayload>(() => supabase.rpc('calibration_cohorts', { p_days: Math.min(f.days, MAX_CUSTOM_SPAN_DAYS) })),
    probe<BoxCohort[]>(() => supabase.rpc('calibration_cohorts_by_box', { p_days: Math.min(Math.max(f.days, 14), 60) })),
    probe<WatchItem[]>(() =>
      supabase.from('ledger_watch_items').select('id, due_at, text, seen_at, created_at, proof, evidence, checked_at').order('due_at', { ascending: true, nullsFirst: false }).limit(50),
    ),
    probe<AlertState[]>(() => supabase.from('ledger_alert_state').select('alert_id, severity, text, rule, first_fired_at, last_seen_at, last_notified_at')),
    probe<AlertEvent[]>(() => supabase.from('ledger_alert_events').select('id, alert_id, transition, severity, text, at, notified').order('at', { ascending: false }).limit(8)),
  ]);
  const { health, cron, plans, families } = inputs;

  // Acceptance §12.1: with period = all, ② must equal calibration_ledger_tracks()
  // to the decimal. Computed here, shown on the page, never silently assumed.
  const agreement: Agreement[] = TRACKS.map((t) => {
    const a = mAll.data?.tracks?.[t] ?? null;
    const b = ledger.data?.tracks?.[t]?.headline ?? null;
    const r3 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 1000);
    const agree = (a?.brier == null && b?.brier == null) || (r3(a?.brier) === r3(b?.brier) && r3(a?.skill) === r3(b?.skill));
    return { track: t, brier_stats: a?.brier ?? null, brier_ledger: b?.brier ?? null, skill_stats: a?.skill ?? null, skill_ledger: b?.skill ?? null, agree };
  });

  // "Since when?" — the evaluator's state row, if one exists for the rule.
  const since = new Map((alertState.data ?? []).map((st) => [st.alert_id, st.first_fired_at]));
  const alerts = evaluateAlerts(inputs, now).map((a) => ({ ...a, since: since.get(a.id) ?? null }));

  return {
    generated_at: now.toISOString(),
    filters: f,
    health, cron, plans, window,
    matrix: { '7': m7, '30': m30, '90': m90, all: mAll },
    ledger, cohorts, boxCohorts, watch, alertState, alertEvents, families, agreement, alerts,
  };
}

/** Wilson score interval — a derived confidence bound, not an aggregate (⑤ whiskers). */
export function wilson(observed: number | null, n: number, z = 1.96): [number, number] | null {
  if (observed == null || n <= 0) return null;
  const p = observed, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
