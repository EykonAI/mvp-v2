/**
 * The posture composite — one formula, in one place.
 *
 * Until IMG-0 the composite carried a fifth, "imagery" term at weight 0.10:
 *
 *   composite = 0.25·air + 0.25·sea + 0.25·conflict + 0.15·grid + 0.10·imagery
 *
 * where imagery was `t.imagery ?? 0.3` — the theatre's value in
 * lib/fixtures/posture_seed.json. No imagery was ever observed: every
 * theatre's composite carried a constant between 0.028 and 0.082 that
 * no instrument produced, and the INTEL glyph drew it as a fifth
 * measured domain. A label that claims what the code does not compute
 * is a lie the build cannot catch (brief §0.2).
 *
 * The term is removed and the four measured weights renormalised to sum
 * to 1, so the composite stays on its 0–1 scale:
 *
 *   composite = (0.25·air + 0.25·sea + 0.25·conflict + 0.15·grid) / 0.90
 *
 * New rows write imagery = NULL. Old rows stored the imagery value they
 * were computed with, so they convert EXACTLY (to rounding) to the new
 * formula — which is what stops a false step appearing on the deploy day
 * in the digest's posture movers and the precursor 30-day series.
 * Readers of a stored composite must go through storedComposite().
 *
 * The imagery domain returns when real observations exist
 * (Imagery Layer build prompt, IMG-8) — not before.
 *
 * IMG-8 (mig 191): it returns ONLY where it is measured. The term is the
 * theatre's share of ADMITTED Sentinel-1 sites whose latest clear look is
 * ≥ 1.5× their own median (imagery_theatre_term). Where it exists the
 * row is written with the original five weights (they sum to 1):
 *
 *   five-domain-v3 = 0.25·air + 0.25·sea + 0.25·conflict + 0.15·grid + 0.10·imagery
 *
 * and where it does not — every theatre until the S1 study is admitted —
 * the four-domain-v2 formula above, imagery NULL. Every row now records
 * its formula in posture_scores.composite_formula, so readers stop
 * inferring it from whether imagery is NULL; only rows with no formula
 * (written before 191) go through the legacy reconstruction.
 */

export const FORMULA_FOUR_DOMAIN = 'four-domain-v2';
export const FORMULA_FIVE_DOMAIN = 'five-domain-v3';
const W_IMAGERY = 0.10;

const W_AIR = 0.25;
const W_SEA = 0.25;
const W_CONFLICT = 0.25;
const W_GRID = 0.15;
const W_MEASURED = W_AIR + W_SEA + W_CONFLICT + W_GRID; // 0.90
const W_LEGACY_IMAGERY = 0.10;

/** Composite from the four measured domains, on a 0–1 scale. */
export function compositeFromDomains(air: number, sea: number, conflict: number, grid: number): number {
  return round3((W_AIR * air + W_SEA * sea + W_CONFLICT * conflict + W_GRID * grid) / W_MEASURED);
}

/** Composite with a MEASURED imagery term (five-domain-v3), on a 0–1 scale. */
export function compositeWithImagery(air: number, sea: number, conflict: number, grid: number, imagery: number): number {
  return round3(W_AIR * air + W_SEA * sea + W_CONFLICT * conflict + W_GRID * grid + W_IMAGERY * imagery);
}

/**
 * A stored posture_scores composite, expressed in the current formula.
 * Rows with imagery IS NULL are already current; rows carrying the legacy
 * fixture imagery value have it removed and are renormalised. Returns null
 * — never 0 — when the row has no composite.
 */
export function storedComposite(composite: unknown, imagery: unknown, formula?: unknown): number | null {
  if (composite === null || composite === undefined || composite === '') return null;
  const c = Number(composite);
  if (!Number.isFinite(c)) return null;
  // A row that names its formula (mig 191 onward) is stored as written.
  if (typeof formula === 'string' && formula.length > 0) return c;
  if (imagery === null || imagery === undefined || imagery === '') return c;
  const i = Number(imagery);
  if (!Number.isFinite(i)) return c;
  return round3((c - W_LEGACY_IMAGERY * i) / W_MEASURED);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * The FOUR-domain composite of any stored row — for readers whose history
 * is four-domain (the precursor library's 30-day vectors), so a theatre
 * gaining a measured imagery term does not step their series.
 */
export function fourDomainComposite(row: {
  composite: unknown; imagery: unknown; composite_formula?: unknown;
  air?: unknown; sea?: unknown; conflict?: unknown; grid?: unknown;
}): number | null {
  if (row.composite_formula === FORMULA_FIVE_DOMAIN) {
    const d = [row.air, row.sea, row.conflict, row.grid].map(v => (v === null || v === undefined || v === '' ? NaN : Number(v)));
    if (d.every(Number.isFinite)) return compositeFromDomains(d[0], d[1], d[2], d[3]);
    return null;
  }
  return storedComposite(row.composite, row.imagery, row.composite_formula);
}
