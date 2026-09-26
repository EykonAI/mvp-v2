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
 */

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

/**
 * A stored posture_scores composite, expressed in the current formula.
 * Rows with imagery IS NULL are already current; rows carrying the legacy
 * fixture imagery value have it removed and are renormalised. Returns null
 * — never 0 — when the row has no composite.
 */
export function storedComposite(composite: unknown, imagery: unknown): number | null {
  if (composite === null || composite === undefined || composite === '') return null;
  const c = Number(composite);
  if (!Number.isFinite(c)) return null;
  if (imagery === null || imagery === undefined || imagery === '') return c;
  const i = Number(imagery);
  if (!Number.isFinite(i)) return c;
  return round3((c - W_LEGACY_IMAGERY * i) / W_MEASURED);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
