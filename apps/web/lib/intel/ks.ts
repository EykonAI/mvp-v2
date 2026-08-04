/**
 * Two-sample Kolmogorov-Smirnov test, dependency-free.
 * Used by the regime-shift cron; kept out of the route file because
 * Next.js route modules may only export handlers, and so the sanity
 * script (scripts/ks-sanity.ts pattern) can exercise the same code the
 * cron runs, not a copy.
 */

/** One day of a window: UTC date + that day's value. */
export interface DailyPoint { d: string; v: number }

/**
 * Two-sample KS statistic D = sup |ECDF_a(x) − ECDF_b(x)|.
 * Ties are handled by stepping BOTH ECDFs past each distinct pooled
 * value before measuring the gap (daily counts are integers, so ties
 * are the norm, not the edge case).
 */
export function ksStatistic(a: number[], b: number[]): number {
  const as = [...a].sort((x, y) => x - y);
  const bs = [...b].sort((x, y) => x - y);
  let i = 0, j = 0, d = 0;
  while (i < as.length && j < bs.length) {
    const v = Math.min(as[i], bs[j]);
    while (i < as.length && as[i] <= v) i++;
    while (j < bs.length && bs[j] <= v) j++;
    d = Math.max(d, Math.abs(i / as.length - j / bs.length));
  }
  return d;
}

/**
 * Asymptotic two-sided KS p-value (Kolmogorov distribution),
 * λ = (√ne + 0.12 + 0.11/√ne)·D with ne the effective sample size.
 * The alternating series converges well inside 100 terms for every λ
 * our window sizes can produce; the result is clamped to [0.0001, 1].
 */
export function ksPValue(d: number, n1: number, n2: number): number {
  if (d <= 0) return 1;
  const ne = (n1 * n2) / (n1 + n2);
  const lambda = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  let sum = 0;
  for (let k = 1; k <= 100; k++) {
    sum += Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lambda * lambda);
  }
  return Math.max(0.0001, Math.min(1, 2 * sum));
}
