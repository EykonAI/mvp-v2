/**
 * query_imagery / query_webcams — the pure half (Imagery IMG-7).
 *
 * The executors in lib/tool-executor.ts read the database; everything that
 * decides what an agent is told lives here so a node script can prove it
 * (scripts/intel/test-imagery-tools.mjs):
 *
 *   · every observation row carries its coverage_state — a look that did
 *     not happen (cloudy, partial swath, no acquisition, processing error)
 *     is a row with a NULL value, never a zero and never dropped;
 *   · summaries COUNT looks by state and report the latest clear value
 *     against its own median; they never add metric values across looks
 *     or sites, so a VOID can never be summed in;
 *   · webcams are returned as eYKON image-proxy URLs plus the operator's
 *     credit — never an upstream URL, never a frame.
 *
 * Pure — no server imports.
 */

export const IMAGERY_SENSORS = ['s2_l2a', 's1_grd'] as const;
export type ImagerySensor = (typeof IMAGERY_SENSORS)[number];

export const VOID_RULE =
  'A row whose coverage_state is not "clear" is a look that did not happen or did not see the site (cloud, partial ' +
  'swath, no acquisition, processing error). Its value is NULL: it is NOT zero and NOT "no activity". Never add, ' +
  'average or compare values across such rows; say the site was not seen on that date.';

export const SENSOR_NOTES: Record<ImagerySensor, string> = {
  s2_l2a:
    'Sentinel-2 L2A optical. metric ndvi_median = median NDVI of the clear pixels inside the site polygon — a spectral ' +
    'proxy for surface cover (a falling NDVI over a mine can mean more bare ground). Not a tonnage, volume or activity claim.',
  s1_grd:
    'Sentinel-1 C-band radar. metric bright_target_area_m2 = area of bright radar return inside the polygon; ' +
    'vessel_equivalents = that area / the median m² per AIS vessel measured at admission — an estimate, not a count. ' +
    'Returned ONLY for sites the Sentinel-1 measurement study admitted; before admission the tool returns none.',
};

export function imageryCredit(year = new Date().getUTCFullYear()): string {
  return `Contains modified Copernicus Sentinel data ${year}`;
}

export interface ObsRow {
  aoi_id: string;
  kind: string | null;
  name: string | null;
  lat: number | null;
  lon: number | null;
  sensor: string;
  acquired_at: string;
  coverage_state: string;
  metric_name: string | null;
  metric_value: number | null;
  baseline_median: number | null;
  baseline_n: number | null;
  vessel_equivalents?: number | null;
}

export interface Look {
  acquired_at: string;
  coverage_state: string;
  /** NULL unless coverage_state is 'clear'. */
  value: number | null;
  baseline_median: number | null;
  baseline_n: number | null;
  ratio_to_baseline: number | null;
  vessel_equivalents?: number | null;
}

export interface SiteSummary {
  aoi_id: string;
  kind: string | null;
  name: string | null;
  lat: number | null;
  lon: number | null;
  metric_name: string | null;
  looks: number;
  looks_by_state: Record<string, number>;
  clear_looks: number;
  latest_look: { acquired_at: string; coverage_state: string } | null;
  latest_clear: Look | null;
  looks_detail: Look[];
}

function toLook(r: ObsRow): Look {
  const clear = r.coverage_state === 'clear' && r.metric_value !== null && Number.isFinite(r.metric_value);
  const value = clear ? r.metric_value : null;
  const ratio =
    value !== null && r.baseline_median !== null && r.baseline_median !== 0 && (r.baseline_n ?? 0) >= 3
      ? Math.round((value / r.baseline_median) * 100) / 100
      : null;
  const look: Look = {
    acquired_at: r.acquired_at,
    coverage_state: r.coverage_state,
    value,
    baseline_median: r.baseline_median,
    baseline_n: r.baseline_n,
    ratio_to_baseline: ratio,
  };
  if (r.sensor === 's1_grd') look.vessel_equivalents = clear ? (r.vessel_equivalents ?? null) : null;
  return look;
}

/** Group rows (any order) into per-site summaries, newest look first, ≤ perSite looks listed. */
export function summariseObservations(rows: ObsRow[], perSite = 8): SiteSummary[] {
  const by = new Map<string, SiteSummary>();
  const sorted = [...rows].sort((a, b) => (a.acquired_at < b.acquired_at ? 1 : a.acquired_at > b.acquired_at ? -1 : 0));
  for (const r of sorted) {
    let s = by.get(r.aoi_id);
    if (!s) {
      s = {
        aoi_id: r.aoi_id, kind: r.kind, name: r.name, lat: r.lat, lon: r.lon, metric_name: null,
        looks: 0, looks_by_state: {}, clear_looks: 0, latest_look: null, latest_clear: null, looks_detail: [],
      };
      by.set(r.aoi_id, s);
    }
    const look = toLook(r);
    s.looks += 1;
    s.looks_by_state[r.coverage_state] = (s.looks_by_state[r.coverage_state] ?? 0) + 1;
    if (!s.latest_look) s.latest_look = { acquired_at: r.acquired_at, coverage_state: r.coverage_state };
    if (look.value !== null) {
      s.clear_looks += 1;
      if (!s.latest_clear) s.latest_clear = look;
      s.metric_name = s.metric_name ?? r.metric_name;
    }
    if (s.looks_detail.length < perSite) s.looks_detail.push(look);
  }
  return Array.from(by.values());
}

/** The whole tool payload for query_imagery. Totals are COUNTS of looks and sites — never sums of values. */
export function imageryPayload(sensor: ImagerySensor, windowDays: number, rows: ObsRow[], extra: Record<string, unknown> = {}) {
  const sites = summariseObservations(rows);
  const byState: Record<string, number> = {};
  for (const r of rows) byState[r.coverage_state] = (byState[r.coverage_state] ?? 0) + 1;
  return {
    sensor,
    window_days: windowDays,
    sites_returned: sites.length,
    sites_with_a_clear_look: sites.filter(s => s.clear_looks > 0).length,
    looks: rows.length,
    looks_by_state: byState,
    sensor_note: SENSOR_NOTES[sensor],
    void_rule: VOID_RULE,
    absence_rule:
      'Only sites with the sensor switched on are imaged. A site missing from this list was not looked at — absence of a site is absence of a look.',
    credit: imageryCredit(),
    ...extra,
    sites,
  };
}

// ─── webcams ───────────────────────────────────────────────────────────

export interface CamRow {
  webcam_id: string;
  provider_id: string;
  name: string;
  latitude: number;
  longitude: number;
  heading_deg: number | null;
  category: string;
  attribution_text: string;
  last_ok_at: string | null;
  nearest_aoi_id: string | null;
  nearest_aoi_name: string | null;
}

export const WEBCAM_RULE =
  'Live public cameras from government operators. A frame shows what the operator\'s camera recorded at the time the ' +
  'operator stamped, not "now". eYKON asserts nothing about a frame beyond place, time fetched and source: no ' +
  'recognition, no counting, no recording. Cite the attribution with any use.';

export function webcamPayload(appUrl: string, rows: CamRow[], limit: number, extra: Record<string, unknown> = {}) {
  const cams = rows.slice(0, limit).map(c => ({
    webcam_id: c.webcam_id,
    name: c.name,
    provider: c.provider_id,
    category: c.category,
    lat: c.latitude,
    lon: c.longitude,
    heading_deg: c.heading_deg,
    last_live_check: c.last_ok_at,
    nearest_site: c.nearest_aoi_id ? { aoi_id: c.nearest_aoi_id, name: c.nearest_aoi_name } : null,
    image_url: `${appUrl.replace(/\/$/, '')}/api/webcams/${encodeURIComponent(c.webcam_id)}/image`,
    attribution: c.attribution_text,
  }));
  const byProvider: Record<string, number> = {};
  for (const c of rows) byProvider[c.provider_id] = (byProvider[c.provider_id] ?? 0) + 1;
  return {
    live_cameras_in_area: rows.length,
    returned: cams.length,
    by_provider: byProvider,
    rule: WEBCAM_RULE,
    absence_rule: 'Only live cameras are listed; a camera that failed, froze or was never checked is omitted. No camera here is not evidence of anything.',
    ...extra,
    cameras: cams,
  };
}
