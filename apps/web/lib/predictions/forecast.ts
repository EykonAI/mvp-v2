/**
 * Shared forecasting helpers for the prediction issuers.
 *
 * v1 statistical baselines — a climatological base-rate (EIA) and a
 * persistence/momentum estimate (chokepoints) — that replace the flat 0.5
 * prior so the Calibration Ledger grades real, informative forecasts instead
 * of the no-skill identity (a flat 0.5 on a binary outcome scores Brier 0.25
 * every time). A future eYKON model can supersede these without touching the
 * resolvers or the scorer; the forecast only ever lands in
 * predicted_distribution.mean.
 */

/** Round a probability to 3 decimals (matches calibration_summary precision). */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Clamp a probability into a sane open interval. Keeps forecasts away from
 * 0/1 overconfidence (a single miss at 0.0/1.0 sends log-loss to infinity)
 * while staying clearly informative. Non-finite input falls back to the
 * neutral 0.5 prior.
 */
export function clampProbability(p: number, lo = 0.05, hi = 0.95): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.max(lo, Math.min(hi, p));
}

/** Standard-normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation. */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return 0.5;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return sign * y;
}
