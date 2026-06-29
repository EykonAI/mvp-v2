// The Reputation Note — eYKON's single credibility score (COMM UX/UI Uplift
// brief §3.2). A 0–100 number with a one-word band, computed from sealed,
// resolved predictions. Accuracy is the spine; volume only buys confidence
// (shrinkage), coverage and recency gate it, and a small capped contribution
// bonus rewards citizenship without ever substituting for being right.
//
// Pure and dependency-free, so the compute-user-reputation cron (which writes
// the score) and the ReputationNote component (which renders band labels and
// colours) share ONE source of truth. Every constant is tunable; the defaults
// are the brief's stated starting points (§3.2 / §7).

export const NOTE_MIN_SAMPLE = 10; // < this many resolved → "Calibrating", never a number
export const SHRINKAGE_K = 20; // credibility shrinkage: S_adj = S_w · n/(n+K)
export const SIGMOID_ALPHA = 4.4; // accuracy-core steepness
export const COVERAGE_TARGET = 0.8; // coverage gate g_cov = min(1, coverage/target)
export const RECENCY_HALFLIFE_DAYS = 180; // recency gate half-life
export const CONTRIBUTION_CAP = 12; // max contribution points (of 100)

const DIFF_W_HORIZON = 0.35;
const DIFF_W_BOLDNESS = 0.3;
const DIFF_W_ARITY = 0.15;
const DIFF_W_DOMAIN = 0.2;
const DIFF_MIN = 0.6;
const DIFF_MAX = 1.8;
const HORIZON_REF_HOURS = 720; // 30-day reference horizon for H_i normalisation

// Per-domain difficulty D_i ∈ [0,1] — a hard domain counts for more. Unknown
// domains default to 0.5 (neutral). Tunable as real cohorts resolve.
const DOMAIN_DIFFICULTY: Record<string, number> = {
  conflict_escalation: 0.9,
  posture_shift: 0.8,
  ais_chokepoint_weekly: 0.65,
  trade_flow: 0.6,
  eia_weekly: 0.5,
};

export type BandKey = 'calibrating' | 'unproven' | 'developing' | 'calibrated' | 'sharp' | 'oracle';

export interface BandMeta {
  key: BandKey;
  label: string;
  min: number; // inclusive lower bound on the Note (ignored for 'calibrating')
  color: string; // a globals.css token
}

// Banded 0–100 ranges (§3.2). 'calibrating' is the cold-start — no number.
export const CALIBRATING: BandMeta = { key: 'calibrating', label: 'Calibrating', min: 0, color: 'var(--ink-dim)' };
export const BANDS: BandMeta[] = [
  { key: 'unproven', label: 'Unproven', min: 0, color: 'var(--ink-dim)' },
  { key: 'developing', label: 'Developing', min: 48, color: 'var(--amber)' },
  { key: 'calibrated', label: 'Calibrated', min: 64, color: 'var(--teal)' },
  { key: 'sharp', label: 'Sharp', min: 78, color: 'var(--teal)' },
  { key: 'oracle', label: 'Oracle', min: 90, color: 'var(--teal)' },
];

// The band for a Note. Below the sample threshold (or with no number) the
// surface reads "Calibrating" — never a fabricated score.
export function bandFor(note: number | null, nResolved: number): BandMeta {
  if (note == null || nResolved < NOTE_MIN_SAMPLE) return CALIBRATING;
  let chosen = BANDS[0];
  for (const b of BANDS) if (note >= b.min) chosen = b;
  return chosen;
}

export interface NoteCall {
  skill: number; // per-call brier-skill (caller bounds it, conventionally [-1,1])
  windowHours: number | null;
  predictedMean: number | null;
  baselineMean: number | null;
  arity: number; // # discrete outcomes; 2 = binary
  feature: string | null;
}

// Per-call difficulty d_i = clamp(0.35·H + 0.30·B + 0.15·O + 0.20·D, 0.6, 1.8).
//   H horizon = log(1+window_h)/log(1+720)   B boldness = 2·|p − baseline|
//   O outcome arity (binary → 0)             D per-domain difficulty
export function perCallDifficulty(c: NoteCall): number {
  const H = Math.log1p(Math.max(0, c.windowHours ?? 0)) / Math.log1p(HORIZON_REF_HOURS);
  const B = c.predictedMean == null || c.baselineMean == null ? 0 : 2 * Math.abs(c.predictedMean - c.baselineMean);
  const O = c.arity > 2 ? Math.min(1, (c.arity - 2) / 4) : 0;
  const D = DOMAIN_DIFFICULTY[c.feature ?? ''] ?? 0.5;
  const raw = DIFF_W_HORIZON * H + DIFF_W_BOLDNESS * B + DIFF_W_ARITY * O + DIFF_W_DOMAIN * D;
  return clamp(raw, DIFF_MIN, DIFF_MAX);
}

// Capped, saturating contribution bonus (≤ CONTRIBUTION_CAP). Saturation +
// the hard cap blunt sybil/engagement-farming, and the follower term is now
// reputation-weighted to resist sybils at the source: `followerRepScore` is a
// SUM of per-follower weights (a follow from a high-Note analyst counts ~its
// note/100; an unrated follower contributes only a small floor ≈0.15), not a
// raw follower COUNT. So 50 zero-reputation follows barely move the score,
// while a handful of credible follows do. Accuracy still dominates: the whole
// bonus is capped at CONTRIBUTION_CAP (12 of 100), unchanged.
export function contributionScore(s: {
  followerRepScore: number; // Σ per-follower reputation weights (see cron loadContribution)
  predictionBackedPosts: number;
  spaces: number;
}): number {
  const sat = (x: number, k: number) => {
    const v = Math.max(0, x) / k;
    return v / (1 + v);
  };
  // Saturating constants. The follower term's k dropped 25 → 12 because the
  // input changed from a raw count to a rep-weighted SUM where each follower
  // adds < 1 (0.15 floor … ~1.0 for a 100-Note follower). With k=12 the term
  // half-saturates around a rep-weighted score of 12 — e.g. ~13 high-Note
  // follows, ~24 average (≈0.5) follows, or ~80 sybil (0.15) follows — keeping
  // the 5-point follower weight comparable to the old raw-count behaviour while
  // making it far harder to farm with cheap zero-reputation accounts.
  const raw =
    5 * sat(s.followerRepScore, 12) + 4 * sat(s.spaces, 3) + 3 * sat(s.predictionBackedPosts, 20);
  return Math.min(CONTRIBUTION_CAP, raw);
}

export interface NoteComponents {
  accuracyCore: number; // Acc — accuracy core before gates (0–100)
  weightedSkill: number; // S_w — difficulty-weighted skill
  shrunkSkill: number; // S_adj — after credibility shrinkage
  coverageGate: number; // g_cov (0–1)
  recencyGate: number; // g_rec (0–1)
  core: number; // Acc · g_cov · g_rec
  contribution: number; // C (0–CONTRIBUTION_CAP)
  nResolved: number;
}

export interface ReputationNoteValue {
  note: number; // 0–100
  band: BandKey;
  components: NoteComponents;
}

export interface NoteInputs {
  calls: NoteCall[]; // resolved calls carrying per-call skill
  nResolved: number;
  coverageRatio: number | null;
  lastResolvedAt: string | null;
  nowMs: number; // injected so the module stays pure/testable
  contribution?: number; // precomputed; clamped here regardless
}

// The composite. Returns null below the sample threshold — the honest
// cold-start, where the surface shows "Calibrating (n/10)" and no score.
export function computeReputationNote(input: NoteInputs): ReputationNoteValue | null {
  const { calls, nResolved } = input;
  if (nResolved < NOTE_MIN_SAMPLE || calls.length === 0) return null;

  let sumWeightedSkill = 0;
  let sumWeight = 0;
  for (const c of calls) {
    const d = perCallDifficulty(c);
    sumWeightedSkill += d * c.skill;
    sumWeight += d;
  }
  const weightedSkill = sumWeight > 0 ? sumWeightedSkill / sumWeight : 0;
  const shrunkSkill = weightedSkill * (nResolved / (nResolved + SHRINKAGE_K));
  const accuracyCore = 100 / (1 + Math.exp(-SIGMOID_ALPHA * shrunkSkill));

  const coverage = input.coverageRatio == null ? 1 : Math.max(0, input.coverageRatio);
  const coverageGate = Math.min(1, coverage / COVERAGE_TARGET);
  const recencyGate = recencyGateFor(input.lastResolvedAt, input.nowMs);
  const core = accuracyCore * coverageGate * recencyGate;

  const contribution = clamp(input.contribution ?? 0, 0, CONTRIBUTION_CAP);
  const note = Math.round(Math.min(100, core + contribution));

  return {
    note,
    band: bandFor(note, nResolved).key,
    components: {
      accuracyCore: round1(accuracyCore),
      weightedSkill: round3(weightedSkill),
      shrunkSkill: round3(shrunkSkill),
      coverageGate: round3(coverageGate),
      recencyGate: round3(recencyGate),
      core: round1(core),
      contribution: round1(contribution),
      nResolved,
    },
  };
}

// g_rec = 0.5 + 0.5·2^(−Δdays/halflife) — current skill counts double a stale one.
function recencyGateFor(lastResolvedAt: string | null, nowMs: number): number {
  if (!lastResolvedAt) return 0.5;
  const then = Date.parse(lastResolvedAt);
  if (!Number.isFinite(then)) return 0.5;
  const days = Math.max(0, (nowMs - then) / 86_400_000);
  return 0.5 + 0.5 * Math.pow(2, -days / RECENCY_HALFLIFE_DAYS);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
