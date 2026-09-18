/**
 * What a convergence's score IS — rendered instead of "p < 0.150".
 *
 * convergence_events.joint_p_value is not a p-value. compute-convergences
 * sets it to 0.3 / K, where K is the number of distinct SOURCE CLASSES in
 * the cluster (media, sensor-firms, sensor-viirs-dnb, sensor-ais), so it
 * takes four values — 0.3, 0.15, 0.1, 0.075 — and no test statistic, null
 * distribution or sample stands behind any of them. Printing it as
 * "p < 0.150" dressed a lookup up as a significance test, on four surfaces,
 * one of them public (/c/[id]). Rev H, PR-10.
 *
 * So every surface renders the thing the number encodes: how many source
 * classes co-occurred. Rows written before the source-class model (26 on
 * 2026-09-18, no source_classes) carry an older formula and render nothing
 * rather than a figure nobody can explain.
 *
 * Pure — no server imports — so client components can use it.
 */
export function sourceClassCount(sourceClasses: unknown): number | null {
  if (!Array.isArray(sourceClasses)) return null;
  const k = new Set(sourceClasses.filter((c): c is string => typeof c === 'string' && c.length > 0)).size;
  return k > 0 ? k : null;
}

/** "2 source classes" · "1 source class" · null for pre-model rows. */
export function convergenceScoreLabel(sourceClasses: unknown): string | null {
  const k = sourceClassCount(sourceClasses);
  if (k == null) return null;
  return `${k} source class${k === 1 ? '' : 'es'}`;
}

/** Tooltip text for the label — what it is and, as importantly, what it is not. */
export const CONVERGENCE_SCORE_TITLE =
  'Distinct source classes that co-occurred in this cell (media, FIRMS thermal, night-lights, AIS). ' +
  'A count, not a statistical test and not a p-value.';
