import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-family calibration for the HOUSE track (migration 126).
 *
 * Two things live here, and only one of them is a correction.
 *
 * THE PRIOR replaces the flat 0.5 both issuers fall back to when their model
 * has too little history. 0.5 is the right answer only when you know nothing;
 * we know the family's base rate. Measured 2026-09-07, of 45 scored house
 * claims, 9 were issued at exactly 0.500 — 3 chokepoint that resolved 0.667,
 * and 6 EIA that resolved 1.000. Those were free losses.
 *
 * THE RECALIBRATION is a one-parameter logit shift, and it is SELF-GATING. It
 * applies to a family only while that family's own leave-one-out test says it
 * helps. Measured at the time of writing:
 *
 *   ais_chokepoint_weekly  n=29  skill -0.0426 -> -0.0086   applied
 *   eia_weekly_inventory   n=16  skill -0.1839 -> -0.3082   NOT applied
 *
 * Recalibration fixes BIAS, not DIRECTION. §8.3 found the EIA forecaster
 * chasing the regime the wrong way, and correcting the mean of a signal whose
 * discrimination is negative amplifies the error. Chokepoint is merely
 * mis-centred, which is what a shift repairs. The gate is recomputed from live
 * data on every read, so it turns itself on and off without anyone having to
 * remember to revisit it.
 *
 * Disjoint by construction: the fit sees only RESOLVED claims, and the claim
 * being issued is unresolved by definition.
 */

export interface FamilyCalibration {
  n: number;
  base_rate: number;
  mean_forecast: number;
  prior: number;
  recal_applied: boolean;
  recal_shift: number;
}

export type CalibrationMap = Record<string, FamilyCalibration>;

/** Never throws: a calibration lookup must not cost the week's forecast. */
export async function loadFamilyCalibration(supabase: SupabaseClient): Promise<CalibrationMap> {
  try {
    const { data, error } = await supabase.rpc('house_family_calibration');
    if (error || !data) return {};
    return data as CalibrationMap;
  } catch {
    return {};
  }
}

/**
 * The fallback an issuer should use when its model produced nothing. Falls
 * back to 0.5 only when the family itself has no measured history — which is
 * the one case where 0.5 is honest.
 */
export function priorFor(cal: CalibrationMap, feature: string): number {
  const f = cal[feature];
  return f && Number.isFinite(f.prior) ? f.prior : 0.5;
}

/**
 * Applies the family's shift in logit space, but only where the gate is open.
 * Returns the input unchanged otherwise — including for any family with no
 * entry, so a new family is never silently corrected by a number it did not
 * earn.
 */
export function applyRecalibration(cal: CalibrationMap, feature: string, p: number): number {
  const f = cal[feature];
  if (!f?.recal_applied || !Number.isFinite(f.recal_shift) || f.recal_shift === 0) return p;
  if (!(p > 0.02 && p < 0.98)) return p; // logit is unstable at the rails
  const shifted = 1 / (1 + Math.exp(-(Math.log(p / (1 - p)) + f.recal_shift)));
  return Number.isFinite(shifted) ? Math.round(shifted * 1000) / 1000 : p;
}

/** What was actually done, for the claim's context — auditable after the fact. */
export function calibrationContext(cal: CalibrationMap, feature: string) {
  const f = cal[feature];
  if (!f) return { calibration: 'no measured history for family' };
  return {
    calibration_prior: f.prior,
    calibration_base_rate: f.base_rate,
    calibration_n: f.n,
    calibration_recal_applied: f.recal_applied,
    calibration_recal_shift: f.recal_applied ? f.recal_shift : 0,
    calibration_note: f.recal_applied
      ? 'logit shift applied — family passes its own leave-one-out test'
      : 'no shift — family does not pass its own leave-one-out test',
  };
}
