import { computePredictionHash } from './hash';

/**
 * Emit machine-track claims for newly opened dark-contact events.
 *
 * THE CLAIM WORDING (founder-visible; changing it changes what eYKON's
 * public, hash-bound record asserts):
 *
 *   "Vessel <name> (MMSI <mmsi>) will be re-observed by eYKON AIS coverage
 *    within 72 h of <opened_at> UTC."
 *
 * The observable is RE-OBSERVATION BY OUR COVERAGE — the same instrument-view
 * wording as the event lifecycle (mig 112). It is not "the transponder will
 * turn on": a vessel that sailed beyond our coverage is indistinguishable
 * from a dark one, and the register must not claim otherwise.
 *
 * TRACK = 'machine'. Migration 098's contract: the machine track is for
 * sensor observables — thousands of auto-resolving claims answering "do our
 * instruments work?", never blended with house or creator, never feeding the
 * Reputation Note. This family is exactly that.
 *
 * THE FORECAST is the family's own measured base rate, Laplace-shrunk toward
 * 0.5: p = (reappeared + 1) / (resolved + 2), computed over COMPLETED
 * COHORTS ONLY — events whose 72 h deadline has already passed, so both
 * outcomes were possible. Two anchor disciplines stack here: disjointness
 * (resolved events only — §17.1: an anchor containing its own window
 * measures nothing) and completeness (deadline elapsed — counting young
 * resolved events reads "has not had time to fail" as a success rate; the
 * first emission tick measured 0.979 that way before this fix). At n=0 the
 * rate is exactly 0.5 — a flat prior, honestly labelled in
 * context.forecast_basis. A base-rate forecast scores ~zero skill BY CONSTRUCTION; for the
 * machine track that is fine — the register is measuring the instrument,
 * not competing on foresight.
 *
 * HASH: same canonical form as the house track (computePredictionHash), so
 * the in-browser verifier works on these rows unchanged. Machine rows are
 * HASHED, never "sealed" — the platform-wide vocabulary rule holds.
 *
 * Idempotent by construction: target_observable is `ais:dark_contact:
 * <mmsi>:<gap_started_at>`, mirroring the event table's UNIQUE
 * (mmsi, gap_started_at) — one claim per gap, ever.
 */

export interface DarkContactEventForClaim {
  id: string;
  mmsi: string;
  name: string | null;
  flag: string | null;
  box_slug: string | null;
  cadence_hours: number;
  silence_ratio_at_open: number;
  confidence_at_open: number;
  gap_started_at: string;
  opened_at: string;
  deadline_at: string;
}

export function darkContactObservable(ev: { mmsi: string; gap_started_at: string }): string {
  return `ais:dark_contact:${ev.mmsi}:${new Date(ev.gap_started_at).toISOString()}`;
}

export function darkContactStatement(ev: DarkContactEventForClaim): string {
  const openedUtc = new Date(ev.opened_at).toISOString().slice(0, 16).replace('T', ' ');
  return `Vessel ${ev.name ?? ev.mmsi} (MMSI ${ev.mmsi}) will be re-observed by eYKON AIS coverage within 72 h of ${openedUtc} UTC.`;
}

/** Laplace-shrunk family base rate from resolved (non-void) events only. */
export function familyBaseRate(reappeared: number, resolvedNonVoid: number): number {
  return Math.round(((reappeared + 1) / (resolvedNonVoid + 2)) * 1000) / 1000;
}

export function buildDarkContactClaimRow(
  ev: DarkContactEventForClaim,
  baseRate: { p: number; k: number; n: number },
  now: Date,
): Record<string, unknown> {
  const targetObservable = darkContactObservable(ev);
  const statement = darkContactStatement(ev);
  const hash = computePredictionHash({
    statement,
    targetObservable,
    resolvesAt: ev.deadline_at,
    issuedAt: now,
    predictedMean: baseRate.p,
  });
  return {
    feature: 'ais_dark_contact_reappearance',
    context: {
      event_id: ev.id,
      box_slug: ev.box_slug,
      cadence_hours: ev.cadence_hours,
      silence_ratio_at_open: ev.silence_ratio_at_open,
      board_confidence_at_open: ev.confidence_at_open,
      forecast_basis:
        baseRate.n === 0
          ? 'flat_prior_no_completed_cohorts_yet'
          : 'laplace_shrunk_base_rate_completed_cohorts_only',
      forecast_base_rate_k: baseRate.k,
      forecast_base_rate_n: baseRate.n,
      // The board confidence is suspicion, not reappearance probability —
      // recorded as context, deliberately NOT used as the forecast.
      note: 'observable = re-observation by eYKON coverage, instrument-view wording; VOID on coverage_lost',
    },
    predicted_distribution: { mean: baseRate.p, type: 'point' },
    target_observable: targetObservable,
    target_window_hours: 72,
    issued_at: now.toISOString(),
    resolves_at: new Date(ev.deadline_at).toISOString(),
    persona: 'analyst',
    statement,
    source: 'ais-darkgap',
    track: 'machine',
    hash,
    // public_id intentionally omitted — DB DEFAULT generates the token.
  };
}
