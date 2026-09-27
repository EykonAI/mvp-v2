/**
 * Shape of /api/imagery/s1 (IMG-6) — shared by the route and the panels.
 * Pure, no server imports.
 */

export type S1State = 'admitted' | 'not admitted' | 'no admission recorded';

export interface S1Pass {
  acquired_at: string;
  coverage_state: string;
  /** NULL on a VOID pass — a look that did not happen, never zero. */
  vessel_equivalents: number | null;
  ratio_to_baseline: number | null;
  baseline_n: number | null;
}

export interface S1Site {
  aoi_id: string;
  slug: string;
  kind: string;
  name: string | null;
  passes: S1Pass[];
}

export interface S1Payload {
  state: S1State;
  admission: {
    id: number;
    recorded_at: string;
    evaluated_n: number;
    admitted_n: number;
    m2_per_vessel: number | null;
  } | null;
  sites: S1Site[];
  note: string;
  credit: string;
}

export const S1_NOTE =
  'Sentinel-1 radar passes. "Vessel-equivalents" = bright radar-return area ÷ the median area per AIS vessel measured at admission — an estimate from one ratio, not a count, and it includes anything bright (platforms, coast). A pass marked "no look" did not happen or did not cover the window; it is not zero ships.';

export function s1Credit(year = new Date().getUTCFullYear()): string {
  return `Contains modified Copernicus Sentinel data ${year}`;
}

interface ReadingRow {
  aoi_id: string;
  kind: string;
  name: string | null;
  acquired_at: string;
  coverage_state: string;
  vessel_equivalents: number | null;
  ratio_to_baseline: number | null;
  baseline_n: number | null;
}

/** Group readings (newest first) into sites, at most `perSite` passes each. */
export function groupReadings(rows: ReadingRow[], perSite = 6): S1Site[] {
  const by = new Map<string, S1Site>();
  for (const r of rows) {
    let s = by.get(r.aoi_id);
    if (!s) {
      s = { aoi_id: r.aoi_id, slug: r.aoi_id.split(':')[1] ?? r.aoi_id, kind: r.kind, name: r.name, passes: [] };
      by.set(r.aoi_id, s);
    }
    if (s.passes.length < perSite) {
      s.passes.push({
        acquired_at: r.acquired_at,
        coverage_state: r.coverage_state,
        vessel_equivalents: r.coverage_state === 'clear' ? r.vessel_equivalents : null,
        ratio_to_baseline: r.coverage_state === 'clear' ? r.ratio_to_baseline : null,
        baseline_n: r.baseline_n,
      });
    }
  }
  return Array.from(by.values()).sort((a, b) => (a.kind === b.kind ? a.aoi_id.localeCompare(b.aoi_id) : a.kind === 'chokepoint' ? -1 : 1));
}
