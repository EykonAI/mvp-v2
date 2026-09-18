/**
 * The judged-only cohort reader (#508, tightened by #513 and mig 155/156) —
 * ONE implementation, shared by the INTEL calibration workspace and the
 * public /calibration page.
 *
 * The headline quotes the newest issuance cohort that is COMPLETE (every
 * deadline passed, mig 137), JUDGED (open = 0: the scorer works 500 claims an
 * hour, so a large cohort is "complete" for hours while mostly unscored), has
 * n >= the minimum sample, and has a defined skill. Machine cohorts are
 * daily; house cohorts are bucketed to ISO weeks. Open cohorts are never
 * quoted: the claims that resolve first are the reappearances (#401).
 *
 * Extracted verbatim from CalibrationWorkspace.tsx in rev H PR-10, when the
 * public page stopped averaging an unordered .limit(5000) of Brier scores
 * across every track (0.263 on 2026-09-18) and started reusing this.
 *
 * Pure — no server imports.
 */

export interface Cohort {
  day: string;
  issued: number;
  n: number;
  open: number;
  complete: boolean;
  /** mig 155: voided claims, so live = issued − void and open = issued − n − void */
  void?: number;
  sum_brier: number;
  sum_y: number;
  sum_absdev: number;
  brier: number | null;
  base_rate: number | null;
  sharpness: number | null;
  skill: number | null;
}

/** The ledger route's MIN_SAMPLE: below it a figure is not quoted. */
export const CALIBRATION_MIN_SAMPLE = 10;

/** Re-aggregate daily cohorts into ISO weeks (Monday start), recomputing skill. */
export function bucketWeeks(points: Cohort[]): Cohort[] {
  const by = new Map<string, Cohort>();
  for (const c of points) {
    const d = new Date(`${c.day}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7;                 // Monday = 0
    const monday = new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
    const acc = by.get(monday) ?? { day: monday, issued: 0, n: 0, open: 0, complete: true, sum_brier: 0, sum_y: 0, sum_absdev: 0, brier: null, base_rate: null, sharpness: null, skill: null };
    acc.issued += c.issued; acc.n += c.n; acc.open += c.open; acc.void = (acc.void ?? 0) + (c.void ?? 0); acc.complete = acc.complete && c.complete;
    acc.sum_brier += Number(c.sum_brier); acc.sum_y += Number(c.sum_y); acc.sum_absdev += Number(c.sum_absdev);
    by.set(monday, acc);
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day)).map(a => {
    if (a.n === 0) return a;
    const brier = a.sum_brier / a.n, base = a.sum_y / a.n, sharp = a.sum_absdev / a.n;
    const denom = base * (1 - base);
    return { ...a, brier, base_rate: base, sharpness: sharp, skill: denom > 0.001 ? 1 - brier / denom : null };
  });
}

/** The cohort series a track is quoted from: house by ISO week, the rest by day. */
export function cohortSeriesFor(trackKey: string, cohorts: Cohort[]): Cohort[] {
  return trackKey === 'house' ? bucketWeeks(cohorts) : cohorts;
}

/**
 * The quoted cohort: newest complete AND fully judged cohort with n >= minSample
 * and a defined skill, or null.
 */
export function lastJudgedCohort(series: Cohort[], minSample: number = CALIBRATION_MIN_SAMPLE): Cohort | null {
  return [...series]
    .filter(c => c.complete && c.open === 0 && c.n >= minSample && c.skill != null)
    .sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null;
}
