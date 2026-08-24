/**
 * AIS coverage boxes — the canonical module.
 *
 * The AIS worker subscribes to ten bounding boxes; a vessel's dark-gap is only
 * evidence of darkness while the box it was last seen in was itself delivering.
 * "Never assert coverage we do not have": a silence observed by a dead
 * instrument is a fact about the instrument.
 *
 * BOX DEFINITIONS EXIST IN THREE PLACES and must stay in sync:
 *   services/ais-ingest/index.js       BOUNDING_BOXES  (the subscription — the
 *                                      worker's Railway root dir cannot import
 *                                      this module, so it keeps its own copy)
 *   supabase/migrations/110_*.sql      refresh_ais_box_liveness()  (the snapshot)
 *   this file                          AIS_BOXES       (canonical: slugs + precedence)
 *
 * Precedence: chokepoints are listed BEFORE broad regions and boxForPosition
 * returns the first match — the boxes overlap (Hormuz sits inside
 * Africa + Indian Ocean), and a vessel in a strait counts toward the strait.
 */

export interface AisBox {
  slug: string;
  label: string;
  kind: 'chokepoint' | 'broad';
  /** [latMin, lonMin, latMax, lonMax] */
  bounds: [number, number, number, number];
}

export const AIS_BOXES: AisBox[] = [
  { slug: 'hormuz',        label: 'Strait of Hormuz',      kind: 'chokepoint', bounds: [24, 54, 28, 58] },
  { slug: 'bab-el-mandeb', label: 'Bab-el-Mandeb',         kind: 'chokepoint', bounds: [11, 42, 14, 45] },
  { slug: 'suez',          label: 'Suez Canal',            kind: 'chokepoint', bounds: [27, 31, 33, 34] },
  { slug: 'bosphorus',     label: 'Bosphorus',             kind: 'chokepoint', bounds: [40.5, 28.5, 41.5, 29.5] },
  { slug: 'malacca',       label: 'Strait of Malacca',     kind: 'chokepoint', bounds: [1, 97, 7, 105] },
  { slug: 'panama',        label: 'Panama Canal',          kind: 'chokepoint', bounds: [8, -81, 10, -79] },
  { slug: 'europe-med',    label: 'Europe + Med',          kind: 'broad',      bounds: [30, -15, 70, 45] },
  { slug: 'americas-atl',  label: 'Americas Atlantic',     kind: 'broad',      bounds: [-10, -90, 60, -30] },
  { slug: 'africa-io',     label: 'Africa + Indian Ocean', kind: 'broad',      bounds: [-40, 10, 40, 60] },
  { slug: 'asia-pacific',  label: 'Asia-Pacific',          kind: 'broad',      bounds: [-15, 90, 50, 180] },
];

/**
 * A box whose newest fix is older than this is DEAD: silence inside it is
 * unmeasurable and any dark-gap there VOIDs rather than scores. 12 h clears
 * ordinary reporting jitter by a wide margin (live boxes deliver hundreds to
 * thousands of fixes per hour) while catching an outage well before it can
 * manufacture a plausible-looking gap.
 */
export const BOX_DEAD_AFTER_H = 12;

/** First matching box in precedence order, or null for open-ocean positions
 *  outside every subscription box (fixes do occasionally arrive from there —
 *  AISStream is not strict about edges — so null means "observed, liveness
 *  untracked", not "unobserved"). */
export function boxForPosition(lat: number | null, lon: number | null): AisBox | null {
  if (lat == null || lon == null) return null;
  for (const b of AIS_BOXES) {
    const [lat0, lon0, lat1, lon1] = b.bounds;
    if (lat >= lat0 && lat <= lat1 && lon >= lon0 && lon <= lon1) return b;
  }
  return null;
}

export interface BoxLiveness {
  slug: string;
  label: string;
  kind: 'chokepoint' | 'broad';
  newest_fix: string | null;
  fixes_last_hour: number;
  vessels: number;
  computed_at: string;
}

export type BoxState = 'live' | 'stale' | 'dead' | 'unknown';

export function boxState(row: BoxLiveness | undefined, nowMs: number = Date.now()): BoxState {
  if (!row || !row.newest_fix) return 'unknown';
  const silentH = (nowMs - new Date(row.newest_fix).getTime()) / 3600_000;
  if (silentH > BOX_DEAD_AFTER_H) return 'dead';
  if (silentH > 1) return 'stale';
  return 'live';
}
