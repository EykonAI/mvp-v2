/**
 * The convergence clustering rules, pure — moved out of
 * app/api/cron/compute-convergences so a node script can prove them
 * (scripts/intel/test-convergence-cluster.mjs). Behaviour is unchanged
 * except for one new source class, 'sensor-s1-sar' (Imagery IMG-6).
 */

// Independence, not domain count, is what makes a convergence mean anything.
// Conflict (ACLED) and Energy (GDELT) are BOTH media-derived: one news wave
// lights up both, so "two domains" can be one source of evidence. Thermal
// (FIRMS radiometry) and Maritime (AIS) are PHYSICALLY independent witnesses —
// a satellite hot pixel and a vessel track don't move with a headline. The
// score below counts distinct SOURCE CLASSES, so redundant media flags no
// longer inflate significance, and a sensor agreeing with the news is what
// actually earns a low p. A domain not in this map counts as its own class.
export const SOURCE_CLASS: Record<string, string> = {
  Conflict: 'media',
  Energy: 'media',
  Maritime: 'sensor-ais',
  Thermal: 'sensor-firms',
  // VIIRS night-lights. A SEPARATE class from thermal because it is a
  // different physical measurement: FIRMS measures mid-infrared radiant
  // power from combustion, Black Marble measures visible-band emitted light,
  // and a refinery can stop flaring while its grid stays lit. They are NOT
  // independent instruments — both are NASA VIIRS-family and the same clouds
  // blind both — and inside one 10° cell neither corroborates the other or
  // anything else; they co-occur (rev H PR-10).
  Nightlights: 'sensor-viirs-dnb',
  // Sentinel-1 C-band radar (IMG-6). Its own class: an active microwave
  // instrument that sees through cloud and at night, independent of every
  // transponder. Flags exist only for readings the S1 study ADMITTED
  // (mig 189); a VOID pass has no value and never becomes a flag.
  SAR: 'sensor-s1-sar',
};

export function sourceClass(domain: string): string {
  return SOURCE_CLASS[domain] ?? `other:${domain}`;
}

export interface FlagLike {
  id?: unknown;
  domain: string;
  flag_type?: string;
  payload?: { latitude?: unknown; longitude?: unknown } | null;
}

export interface Cluster<F extends FlagLike> {
  key: string;
  lat: number;
  lon: number;
  flags: F[];
  domains: string[];
  classes: string[];
  K: number;
  joint_p_value: number;
  corroboration_level: 'sensor-confirmed' | 'multi-source' | 'single-source';
}

/**
 * Group flags into cellDeg×cellDeg cells; a cell with ≥ 2 distinct domains
 * that has not already produced a convergence (occupied) becomes a cluster.
 * joint_p_value is 0.3 / K over distinct source classes — a lookup, not a
 * test statistic (see convergenceScore.ts).
 */
export function clusterFlags<F extends FlagLike>(flags: F[], occupied: Set<string>, cellDeg: number): Cluster<F>[] {
  const bins = new Map<string, F[]>();
  for (const f of flags) {
    const lat = Number(f.payload?.latitude);
    const lon = Number(f.payload?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${Math.floor(lat / cellDeg) * cellDeg}:${Math.floor(lon / cellDeg) * cellDeg}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key)!.push(f);
  }

  const out: Cluster<F>[] = [];
  for (const [key, cluster] of bins) {
    const domains = new Set<string>(cluster.map(c => c.domain));
    if (domains.size < 2) continue; // need at least two distinct domains to even consider a convergence
    if (occupied.has(key)) continue; // already emitted a convergence for this cell in-window
    occupied.add(key);

    //   K = 1 → 0.30  (single-source: same evidence twice; barely a convergence)
    //   K = 2 → 0.15
    //   K = 3 → 0.10
    const classSet = new Set<string>(Array.from(domains).map(sourceClass));
    const classes = Array.from(classSet).sort();
    const K = classSet.size;
    const joint_p_value = Math.min(0.5, 0.3 / Math.max(K, 1));
    const hasSensor = classes.some(c => c.startsWith('sensor'));
    const corroboration_level =
      K >= 2 && hasSensor ? 'sensor-confirmed' : K >= 2 ? 'multi-source' : 'single-source';
    const [lat, lon] = key.split(':').map(Number);
    out.push({ key, lat, lon, flags: cluster, domains: Array.from(domains), classes, K, joint_p_value, corroboration_level });
  }
  return out;
}
