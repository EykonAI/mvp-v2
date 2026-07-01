import { createServerSupabase } from '@/lib/supabase-server';

// BRIEFS · Convergence detail (the /briefs/convergence/[id] drill-down). A
// single multi-domain convergence event: synthesis, contributing anomalies,
// p-value, and a bounding box for the mini-map. Columns verified via supabase-ro
// (convergence_events) per the verify-don't-assert directive.

export interface ConvergenceAnomaly {
  domain: string;
  label: string;
}
export interface ConvergenceBbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}
export interface ConvergenceDetail {
  id: string;
  location: string;
  lat: number | null;
  lon: number | null;
  bbox: ConvergenceBbox | null;
  jointPValue: number;
  anomalies: ConvergenceAnomaly[];
  synthesis: string;
  createdAt: string;
}

interface ConvRow {
  id: string;
  location: string | null;
  bounding_box: { lat_min?: number; lat_max?: number; lon_min?: number; lon_max?: number } | null;
  joint_p_value: number | string | null;
  contributing_anomalies: Array<{ domain?: string; label?: string } | string> | null;
  synthesis: string | null;
  created_at: string;
}

function parseLatLon(location: string | null): { lat: number | null; lon: number | null } {
  if (!location) return { lat: null, lon: null };
  const m = location.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return { lat: null, lon: null };
  return { lat: Number(m[1]), lon: Number(m[2]) };
}

export async function loadConvergence(id: string): Promise<ConvergenceDetail | null> {
  try {
    const supabase = createServerSupabase();
    const { data } = await supabase
      .from('convergence_events')
      .select('id, location, bounding_box, joint_p_value, contributing_anomalies, synthesis, created_at')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const r = data as unknown as ConvRow;

    const bb = r.bounding_box;
    const bbox: ConvergenceBbox | null =
      bb && typeof bb.lat_min === 'number' && typeof bb.lat_max === 'number' && typeof bb.lon_min === 'number' && typeof bb.lon_max === 'number'
        ? { latMin: bb.lat_min, latMax: bb.lat_max, lonMin: bb.lon_min, lonMax: bb.lon_max }
        : null;

    // Prefer the bounding-box centre for the map; fall back to the
    // "(lat, lon)" location string.
    let lat: number | null = null;
    let lon: number | null = null;
    if (bbox) {
      lat = (bbox.latMin + bbox.latMax) / 2;
      lon = (bbox.lonMin + bbox.lonMax) / 2;
    } else {
      const p = parseLatLon(r.location);
      lat = p.lat;
      lon = p.lon;
    }

    const anomalies: ConvergenceAnomaly[] = (r.contributing_anomalies ?? []).map((a) =>
      typeof a === 'string'
        ? { domain: 'other', label: a }
        : { domain: a.domain ?? 'other', label: a.label ?? 'anomaly' },
    );

    return {
      id: r.id,
      location: r.location ?? '—',
      lat,
      lon,
      bbox,
      jointPValue: r.joint_p_value != null ? Number(r.joint_p_value) : 0,
      anomalies,
      synthesis: r.synthesis ?? '',
      createdAt: r.created_at,
    };
  } catch {
    return null;
  }
}
