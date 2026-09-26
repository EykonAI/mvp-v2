/**
 * Sentinel-2 L2A observation engine (Imagery Layer IMG-2).
 *
 * For one AOI and one window it asks the Statistical API, per acquisition
 * day, for two things measured over the AOI POLYGON (never the scene):
 *
 *   A · coverage and cloud — what share of the AOI the acquisition covered,
 *       and what share of the covered pixels the scene classification (SCL)
 *       flags as cloud, cloud shadow or cirrus;
 *   B · the metric — the MEDIAN NDVI of the AOI's clear pixels.
 *
 * and classifies each acquisition with pinned thresholds. Every
 * acquisition becomes a row, cloudy or not: a cloudy pass is a VOID row,
 * so "we looked and it was cloudy" is on record and never confused with
 * "we did not look" (brief §0.2). A value is attached only to a clear look;
 * the database refuses anything else (mig 183, io_value_only_when_clear).
 *
 * Why NDVI, and what it is not: over a mine a FALLING median NDVI means
 * less vegetation inside the polygon — the v1 proxy for exposed ground and
 * stockpiles that the retired monthly cron also used (as a MEAN; this is
 * the median). It is a spectral change proxy, never a tonnage or a volume.
 */

import {
  bandStats,
  estimatePu,
  medianOf,
  postProcessPng,
  postStatistics,
  type StatsInterval,
} from './cdse';

// ── Pinned parameters (echoed by the cron; change = new version) ──────
export const S2_ENGINE_VERSION = 's2-engine-v1';
export const S2_PARAMS = {
  pixel_m: 10,
  max_px: 2000,
  /** Share of the AOI an acquisition must cover to count as a look at all. */
  min_covered_fraction: 0.99,
  /** Above this share of cloudy covered pixels the look is 'partly_cloudy' (VOID). */
  max_clear_cloud_fraction: 0.1,
  /** Above this it is 'cloudy'. */
  cloudy_fraction: 0.5,
  /** SCL classes treated as not-a-clear-look: 3 shadow, 8/9 cloud, 10 cirrus. */
  scl_cloud_classes: [3, 8, 9, 10],
  metric_name: 'ndvi_median',
  chip_px: 512,
} as const;

export type CoverageState = 'clear' | 'partly_cloudy' | 'cloudy' | 'partial_swath' | 'no_acquisition' | 'processing_error';

export function classify(covered: number | null, cloud: number | null): CoverageState {
  if (covered === null || !Number.isFinite(covered) || covered <= 0) return 'no_acquisition';
  if (covered < S2_PARAMS.min_covered_fraction) return 'partial_swath';
  if (cloud === null || !Number.isFinite(cloud)) return 'processing_error';
  if (cloud > S2_PARAMS.cloudy_fraction) return 'cloudy';
  if (cloud > S2_PARAMS.max_clear_cloud_fraction) return 'partly_cloudy';
  return 'clear';
}

const CLOUD_TEST = S2_PARAMS.scl_cloud_classes.map(c => `s.SCL === ${c}`).join(' || ');

// A · coverage and cloud: dataMask marks covered pixels; cloud is 0/1.
const COVER_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ['SCL', 'dataMask'] }],
    output: [{ id: 'cloud', bands: 1 }, { id: 'dataMask', bands: 1 }],
  };
}
function evaluatePixel(s) {
  return { cloud: [(${CLOUD_TEST}) ? 1 : 0], dataMask: [s.dataMask] };
}`;

// B · NDVI over CLEAR covered pixels only (cloud pixels masked out).
const NDVI_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ['B04', 'B08', 'SCL', 'dataMask'] }],
    output: [{ id: 'ndvi', bands: 1, sampleType: 'FLOAT32' }, { id: 'dataMask', bands: 1 }],
  };
}
function evaluatePixel(s) {
  const cloudy = ${CLOUD_TEST};
  return { ndvi: [(s.B08 - s.B04) / (s.B08 + s.B04 + 1e-6)], dataMask: [cloudy ? 0 : s.dataMask] };
}`;

const TRUECOLOR_EVALSCRIPT = `//VERSION=3
function setup() { return { input: ['B02', 'B03', 'B04'], output: { bands: 3 } }; }
function evaluatePixel(s) { return [2.5 * s.B04, 2.5 * s.B03, 2.5 * s.B02]; }`;

export interface DueAoi {
  aoi_id: string;
  kind: string;
  name: string | null;
  geojson: string;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  area_km2: number;
  window_from: string;
  window_to: string;
}

export interface S2Row {
  aoi_id: string;
  acquired_at: string;
  coverage_state: CoverageState;
  cloud_fraction_aoi: number | null;
  aoi_covered_fraction: number | null;
  metric_name: string | null;
  metric_stat: 'median' | null;
  metric_value: number | null;
  chip_path: string | null;
  pu_cost: number;
  request_id: string;
}

/** Output grid at ~10 m over the AOI's bounding box, capped at max_px a side. */
export function gridFor(aoi: Pick<DueAoi, 'xmin' | 'ymin' | 'xmax' | 'ymax'>) {
  const midLat = (aoi.ymin + aoi.ymax) / 2;
  const dxM = (aoi.xmax - aoi.xmin) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const dyM = (aoi.ymax - aoi.ymin) * 110_574;
  const width = Math.max(1, Math.min(S2_PARAMS.max_px, Math.round(dxM / S2_PARAMS.pixel_m)));
  const height = Math.max(1, Math.min(S2_PARAMS.max_px, Math.round(dyM / S2_PARAMS.pixel_m)));
  const pixelAreaM2 = (dxM / width) * (dyM / height);
  return { width, height, pixelAreaM2 };
}

/**
 * Covered fraction of the POLYGON. (sampleCount − noDataCount) is the number
 * of pixels inside the polygon that carry data, whether or not the API counts
 * pixels outside the polygon in sampleCount — so dividing by the polygon's
 * expected pixel count is right either way.
 */
export function coveredFraction(
  stats: { sampleCount?: number; noDataCount?: number } | null,
  areaKm2: number,
  pixelAreaM2: number,
): number | null {
  if (!stats || typeof stats.sampleCount !== 'number') return null;
  const valid = stats.sampleCount - (stats.noDataCount ?? 0);
  const expected = (areaKm2 * 1e6) / pixelAreaM2;
  if (!(expected > 0)) return null;
  return Math.max(0, Math.min(1, valid / expected));
}

function statsBody(aoi: DueAoi, evalscript: string, width: number, height: number, withMedian: boolean) {
  return {
    input: {
      bounds: {
        geometry: JSON.parse(aoi.geojson),
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [{ type: 'sentinel-2-l2a' }],
    },
    aggregation: {
      timeRange: { from: aoi.window_from, to: aoi.window_to },
      aggregationInterval: { of: 'P1D' },
      evalscript,
      width,
      height,
    },
    calculations: withMedian
      ? { default: { statistics: { default: { percentiles: { k: [50] } } } } }
      : { default: {} },
  };
}

function dayOf(iv: StatsInterval): string {
  return `${iv.interval.from.slice(0, 10)}T00:00:00Z`;
}

/**
 * Observe one AOI over its window. Returns one row per acquisition day the
 * API reported, plus the PU estimate for the calls made.
 */
export async function observeAoi(
  token: string,
  aoi: DueAoi,
  runId: string,
): Promise<{ rows: S2Row[]; puEstimate: number; daysReturned: number }> {
  const { width, height, pixelAreaM2 } = gridFor(aoi);

  const cover = await postStatistics(token, statsBody(aoi, COVER_EVALSCRIPT, width, height, false));
  let pu = estimatePu({ width, height, inputBands: 1, samples: Math.max(cover.length, 1), api: 'statistics' });

  const perDay = new Map<string, { covered: number | null; cloud: number | null }>();
  for (const iv of cover) {
    const st = bandStats(iv, 'cloud');
    const covered = coveredFraction(st, aoi.area_km2, pixelAreaM2);
    const cloud = typeof st?.mean === 'number' && Number.isFinite(st.mean) ? st.mean : null;
    perDay.set(dayOf(iv), { covered, cloud });
  }

  const states = new Map<string, CoverageState>();
  for (const [day, v] of perDay) states.set(day, classify(v.covered, v.cloud));

  // The metric is asked for only when at least one day is clear.
  const medians = new Map<string, number>();
  if ([...states.values()].includes('clear')) {
    const ndvi = await postStatistics(token, statsBody(aoi, NDVI_EVALSCRIPT, width, height, true));
    pu += estimatePu({ width, height, inputBands: 3, samples: Math.max(ndvi.length, 1), api: 'statistics' });
    for (const iv of ndvi) {
      const m = medianOf(bandStats(iv, 'ndvi'));
      if (m !== null) medians.set(dayOf(iv), m);
    }
  }

  const rows: S2Row[] = [];
  for (const [day, v] of perDay) {
    let state = states.get(day)!;
    // A day on which no Sentinel-2 swath touched the AOI is not a look — it
    // is the revisit gap. The check log (imagery_aoi_checks) records that we
    // asked; a row per empty day would only bury the real looks.
    if (state === 'no_acquisition') continue;
    let value: number | null = null;
    if (state === 'clear') {
      value = medians.get(day) ?? null;
      // clear sky but no median back: record the look, not an invented number
      if (value === null) state = 'processing_error';
    }
    rows.push({
      aoi_id: aoi.aoi_id,
      acquired_at: day,
      coverage_state: state,
      cloud_fraction_aoi: round4(v.cloud),
      aoi_covered_fraction: round4(v.covered),
      metric_name: value === null ? null : S2_PARAMS.metric_name,
      metric_stat: value === null ? null : 'median',
      metric_value: value === null ? null : round4(value),
      chip_path: null,
      pu_cost: 0,
      request_id: runId,
    });
  }
  // spread the call cost over the rows it produced (estimate, see cdse.ts)
  const share = rows.length ? round4(pu / rows.length) ?? 0 : 0;
  for (const r of rows) r.pu_cost = share;
  return { rows, puEstimate: round4(pu) ?? 0, daysReturned: perDay.size };
}

/** True-colour chip of one clear acquisition day, clipped to the AOI bbox. */
export async function fetchChip(token: string, aoi: DueAoi, day: string): Promise<{ png: ArrayBuffer; pu: number }> {
  const d = day.slice(0, 10);
  const png = await postProcessPng(token, {
    input: {
      bounds: { bbox: [aoi.xmin, aoi.ymin, aoi.xmax, aoi.ymax], properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { timeRange: { from: `${d}T00:00:00Z`, to: `${d}T23:59:59Z` }, mosaickingOrder: 'leastCC' } }],
    },
    output: {
      width: S2_PARAMS.chip_px,
      height: S2_PARAMS.chip_px,
      responses: [{ identifier: 'default', format: { type: 'image/png' } }],
    },
    evalscript: TRUECOLOR_EVALSCRIPT,
  });
  return { png, pu: estimatePu({ width: S2_PARAMS.chip_px, height: S2_PARAMS.chip_px, inputBands: 3, samples: 1, api: 'process' }) };
}

export function chipPath(aoiId: string, day: string): string {
  return `imagery/s2/${aoiId.replace(/[^A-Za-z0-9_.-]/g, '_')}/${day.slice(0, 10)}.png`;
}

function round4(n: number | null): number | null {
  return n === null || !Number.isFinite(n) ? null : Math.round(n * 10000) / 10000;
}
