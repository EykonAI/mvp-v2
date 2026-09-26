/**
 * Sentinel-1 GRD reading for the IMG-3 measurement study.
 *
 * For one anchorage AOI and one window:
 *   1. the Catalog API lists every IW pass that intersects the polygon, with
 *      its EXACT sensing time — the study pairs each pass with the AIS count
 *      sampled within ±30 min, so a day-level date is not enough;
 *   2. per pass, one Statistical API request over the POLYGON returns the
 *      share of covered pixels whose VV backscatter (sigma0, linear) exceeds
 *      a pinned threshold, and how much of the polygon the swath covered.
 *
 * The metric is bright_target_area_m2 = bright share × covered pixels ×
 * pixel area. It is NOT a vessel count (object counting needs connected
 * components the Statistical API cannot compute), and it includes anything
 * bright — platforms, breakwaters, coastline caught in the polygon. That is
 * acceptable for the study: a fixed clutter offset does not change Spearman
 * ranks over time at one anchorage. Whether the reading tracks ships is
 * exactly what the study measures; nothing reads it until it is admitted.
 */

import { bandStats, estimatePu, postStatistics } from './cdse';
import { coveredFraction, type DueAoi } from './s2';

export const S1_ENGINE_VERSION = 's1-study-v1';
export const CATALOG_URL = 'https://sh.dataspace.copernicus.eu/catalog/v1/search';

export const S1_PARAMS = {
  /** VV sigma0 (linear) above which a pixel is a bright target ≈ −5.2 dB. */
  vv_bright_linear: 0.3,
  /** 20 m cells: IW GRD resolution is ~20×22 m, so 10 m adds cost, not ships. */
  pixel_m: 20,
  max_px: 2000,
  min_covered_fraction: 0.99,
  acquisition_mode: 'IW',
  polarization: 'DV',
  back_coeff: 'SIGMA0_ELLIPSOID',
  orthorectify: true,
  dem: 'COPERNICUS_30',
  /** Passes whose sensing times fall within this many seconds are one pass (adjacent tiles). */
  same_pass_seconds: 120,
  metric_name: 'bright_target_area_m2',
  /** PU multiplier assumed for orthorectification (documented as a factor, not its value). */
  pu_orthorectify_factor: 2,
} as const;

const BRIGHT_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ['VV', 'dataMask'] }],
    output: [{ id: 'bright', bands: 1 }, { id: 'dataMask', bands: 1 }],
  };
}
function evaluatePixel(s) {
  return { bright: [s.VV > ${S1_PARAMS.vv_bright_linear} ? 1 : 0], dataMask: [s.dataMask] };
}`;

export function s1Grid(aoi: Pick<DueAoi, 'xmin' | 'ymin' | 'xmax' | 'ymax'>) {
  const midLat = (aoi.ymin + aoi.ymax) / 2;
  const dxM = (aoi.xmax - aoi.xmin) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const dyM = (aoi.ymax - aoi.ymin) * 110_574;
  const width = Math.max(1, Math.min(S1_PARAMS.max_px, Math.round(dxM / S1_PARAMS.pixel_m)));
  const height = Math.max(1, Math.min(S1_PARAMS.max_px, Math.round(dyM / S1_PARAMS.pixel_m)));
  return { width, height, pixelAreaM2: (dxM / width) * (dyM / height) };
}

/** Collapse sensing times from adjacent tiles of one pass into one time. */
export function distinctPasses(times: string[]): string[] {
  const sorted = [...new Set(times)].sort();
  const out: string[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(Date.parse(t) - Date.parse(last)) <= S1_PARAMS.same_pass_seconds * 1000) continue;
    out.push(t);
  }
  return out;
}

export async function catalogPasses(token: string, aoi: DueAoi): Promise<{ passes: string[]; pu: number }> {
  const times: string[] = [];
  let next: unknown = undefined;
  let calls = 0;
  do {
    const body: Record<string, unknown> = {
      collections: ['sentinel-1-grd'],
      intersects: JSON.parse(aoi.geojson),
      datetime: `${new Date(aoi.window_from).toISOString()}/${new Date(aoi.window_to).toISOString()}`,
      limit: 100,
      filter: { op: 'eq', args: [{ property: 'sar:instrument_mode' }, S1_PARAMS.acquisition_mode] },
      'filter-lang': 'cql2-json',
      fields: { include: ['properties.datetime'], exclude: ['assets', 'links', 'geometry'] },
    };
    if (next !== undefined) body.next = next;
    const res = await fetch(CATALOG_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`catalog: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { features?: Array<{ properties?: { datetime?: string } }>; context?: { next?: unknown } };
    for (const f of json.features ?? []) if (f.properties?.datetime) times.push(f.properties.datetime);
    next = json.context?.next;
    calls += 1;
  } while (next !== undefined && next !== null && calls < 10);
  // Catalog queries cost a floor of 0.01 PU each (CDSE PU documentation).
  return { passes: distinctPasses(times), pu: 0.01 * calls };
}

export interface S1Row {
  aoi_id: string;
  acquired_at: string;
  coverage_state: 'clear' | 'partial_swath' | 'no_acquisition' | 'processing_error';
  cloud_fraction_aoi: null;
  aoi_covered_fraction: number | null;
  metric_name: string | null;
  metric_stat: 'area_m2' | null;
  metric_value: number | null;
  chip_path: null;
  pu_cost: number;
  request_id: string;
}

/** One pass → one row (or null when the swath did not touch the polygon). */
export async function readPass(token: string, aoi: DueAoi, sensedAt: string, runId: string): Promise<S1Row | null> {
  const { width, height, pixelAreaM2 } = s1Grid(aoi);
  const t = Date.parse(sensedAt);
  const body = {
    input: {
      bounds: { geometry: JSON.parse(aoi.geojson), properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
      data: [
        {
          type: 'sentinel-1-grd',
          dataFilter: {
            acquisitionMode: S1_PARAMS.acquisition_mode,
            polarization: S1_PARAMS.polarization,
            resolution: 'HIGH',
          },
          processing: {
            backCoeff: S1_PARAMS.back_coeff,
            orthorectify: S1_PARAMS.orthorectify,
            demInstance: S1_PARAMS.dem,
          },
        },
      ],
    },
    aggregation: {
      timeRange: { from: new Date(t - 60_000).toISOString(), to: new Date(t + 60_000).toISOString() },
      aggregationInterval: { of: 'P1D', lastIntervalBehavior: 'SHORTEN' },
      evalscript: BRIGHT_EVALSCRIPT,
      width,
      height,
    },
    calculations: { default: {} },
  };
  const intervals = await postStatistics(token, body);
  const pu = estimatePu({ width, height, inputBands: 1, samples: 1, api: 'statistics' }) * S1_PARAMS.pu_orthorectify_factor;
  const st = intervals.length ? bandStats(intervals[0], 'bright') : null;
  const covered = coveredFraction(st, aoi.area_km2, pixelAreaM2);
  if (covered === null || covered <= 0) return null; // the swath missed the polygon: not a look
  const brightShare = typeof st?.mean === 'number' && Number.isFinite(st.mean) ? st.mean : null;
  const validPx = (st?.sampleCount ?? 0) - (st?.noDataCount ?? 0);
  let state: S1Row['coverage_state'] = covered >= S1_PARAMS.min_covered_fraction ? 'clear' : 'partial_swath';
  let value: number | null = null;
  if (state === 'clear') {
    if (brightShare === null) state = 'processing_error';
    else value = Math.round(brightShare * validPx * pixelAreaM2);
  }
  return {
    aoi_id: aoi.aoi_id,
    acquired_at: new Date(t).toISOString(),
    coverage_state: state,
    cloud_fraction_aoi: null,
    aoi_covered_fraction: Math.round(covered * 10000) / 10000,
    metric_name: value === null ? null : S1_PARAMS.metric_name,
    metric_stat: value === null ? null : 'area_m2',
    metric_value: value,
    chip_path: null,
    pu_cost: Math.round(pu * 10000) / 10000,
    request_id: runId,
  };
}
