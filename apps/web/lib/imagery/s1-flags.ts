/**
 * Sentinel-1 readings → anomaly_flags for the convergence engine (IMG-6).
 *
 * The candidates come from imagery_s1_flag_candidates() (mig 189), which
 * returns nothing unless the S1 method was ADMITTED by a recorded study.
 * This function repeats the value rules anyway, because a flag is a claim
 * that something was seen: a pass with no value (VOID — no acquisition, a
 * partial swath, a processing error) or no baseline is never a flag.
 *
 * Pure — no server imports — so scripts/intel/test-convergence-cluster.mjs
 * can prove the VOID rule end to end with a fixture cluster.
 */

export const S1_FLAG_SOURCE = 'imagery-s1';
export const S1_FLAG_DOMAIN = 'SAR';
/** A reading at ≥ this multiple of its own median baseline is a flag (mig 189 uses the same). */
export const S1_FLAG_MIN_RATIO = 1.5;
export const S1_FLAG_MIN_BASELINE_N = 3;

export interface S1Candidate {
  site_key: string;
  aoi_id: string;
  kind: string;
  name: string | null;
  latitude: number;
  longitude: number;
  acquired_at: string;
  coverage_state?: string;
  bright_area_m2: number | null;
  vessel_equivalents: number | null;
  baseline_median: number | null;
  baseline_n: number | null;
  ratio_to_baseline: number | null;
  admission_id: number;
}

export interface S1Flag {
  source: string;
  domain: string;
  flag_type: string;
  severity: 'medium' | 'high';
  payload: Record<string, unknown> & { site_key: string; latitude: number; longitude: number };
}

export function s1FlagsFromCandidates(cands: S1Candidate[], alreadyFlagged: Set<string>): S1Flag[] {
  const out: S1Flag[] = [];
  for (const c of cands) {
    if (c.coverage_state !== undefined && c.coverage_state !== 'clear') continue; // VOID: not a look
    if (c.bright_area_m2 === null || !Number.isFinite(c.bright_area_m2)) continue;
    if ((c.baseline_n ?? 0) < S1_FLAG_MIN_BASELINE_N || c.ratio_to_baseline === null) continue;
    if (c.ratio_to_baseline < S1_FLAG_MIN_RATIO) continue;
    if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) continue;
    if (alreadyFlagged.has(c.site_key)) continue;
    alreadyFlagged.add(c.site_key);
    out.push({
      source: S1_FLAG_SOURCE,
      domain: S1_FLAG_DOMAIN,
      flag_type: c.kind === 'chokepoint' ? 's1_strait_above_baseline' : 's1_anchorage_above_baseline',
      severity: c.ratio_to_baseline >= 2 ? 'high' : 'medium',
      payload: {
        site_key: c.site_key,
        latitude: c.latitude,
        longitude: c.longitude,
        aoi_id: c.aoi_id,
        name: c.name,
        acquired_at: c.acquired_at,
        bright_area_m2: c.bright_area_m2,
        vessel_equivalents: c.vessel_equivalents,
        baseline_median: c.baseline_median,
        baseline_n: c.baseline_n,
        ratio_to_baseline: c.ratio_to_baseline,
        admission_id: c.admission_id,
        instrument: 'Sentinel-1 C-band SAR (Copernicus), bright radar return area — an estimate, not a vessel count',
      },
    });
  }
  return out;
}
