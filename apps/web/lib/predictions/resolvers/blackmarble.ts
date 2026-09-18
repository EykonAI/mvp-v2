import type { Resolver, SupabaseAny } from './types';
import { instrumentDataClock, windowVerdict } from './data-clock';

/**
 * Black Marble resolver (machine track, mig 128) for both night-lights
 * families.
 *
 *   a clear night at or above the frozen threshold -> observed = 1
 *   clear nights with a retrieval, none reaching it -> observed = 0
 *   clear nights, none carrying a retrieval        -> VOID (Reality Check PR-1)
 *   NO confident_clear night in the window         -> VOID
 *
 * A clear night counts only if it carries a radiance_3x3 retrieval. NULL is
 * "no usable look", never zero — the same gate as the Reality Check
 * classifier (build prompt D-4). The family base rates (mig 128/142 plan)
 * were measured with max(radiance_3x3), which already skips NULLs; this
 * brings the resolver into line with them.
 *
 * The VOID cases are the whole reason this sensor can be trusted. Only 43% of
 * readings are confident_clear, and cloud scatters city light back at the
 * sensor — cloudy pixels average 3,010 nW against 29.6 on clear ones. Scoring
 * a cloudy night as darkness would let weather confirm every outage claim we
 * ever make.
 *
 * The threshold is read FROM THE CLAIM, never recomputed. The baseline it was
 * derived from moves as new nights land; a pass mark that drifts after issue
 * is not a pass mark.
 *
 * Lookup is by context, not by parsing target_observable (#465).
 */

type Ctx = {
  site_key?: unknown; flagged_period?: unknown;
  horizon_days?: unknown; recovery_threshold?: unknown;
};

export const resolveBlackmarble: Resolver = async (row, supabase) => {
  const ctx = (row.context ?? {}) as Ctx;
  const siteKey = typeof ctx.site_key === 'string' ? ctx.site_key : null;
  const period = typeof ctx.flagged_period === 'string' ? ctx.flagged_period : null;
  const horizon = Number(ctx.horizon_days);
  const threshold = Number(ctx.recovery_threshold);

  if (!siteKey || !period || !Number.isFinite(horizon) || !Number.isFinite(threshold)) {
    return {
      observed: 0,
      source_url: '/intel/calibration',
      void_reason: 'night-lights claim missing site_key/flagged_period/horizon_days/recovery_threshold',
    };
  }

  const facilityIds = await facilitiesAtSite(siteKey, supabase);
  if (facilityIds === null) return null;                 // lookup failed — retry, never assume
  if (facilityIds.length === 0) {
    return { observed: 0, source_url: '/intel/calibration', void_reason: `no facility resolves to site ${siteKey}` };
  }

  const end = new Date(Date.parse(`${period}T00:00:00Z`) + horizon * 86_400_000).toISOString().slice(0, 10);

  // Judge nothing the instrument has not finished publishing (see data-clock.ts).
  const clock = await instrumentDataClock('blackmarble_facility_radiance', supabase);
  const verdict = windowVerdict('night-lights', clock, end);
  if (verdict.kind === 'defer') return null;            // window not yet published — retry
  if (verdict.kind === 'void') {
    return { observed: 0, source_url: '/intel/calibration', void_reason: verdict.reason };
  }

  const { data, error } = await supabase
    .from('blackmarble_facility_radiance')
    .select('radiance_3x3, period')
    .in('facility_id', facilityIds)
    .eq('cloud_confidence', 'confident_clear')   // the only readings that mean anything
    .gt('period', period)
    .lte('period', end);

  if (error) return null;

  const clear = (data ?? []) as ClearNight[];
  if (clear.length === 0) {
    // Cloud on every night of a window the instrument HAS published (the
    // data-clock guard above rules out "not yet published"). Still "we did
    // not look", and still not darkness.
    return {
      observed: 0,
      source_url: '/intel/calibration',
      void_reason: `no confident_clear night for site ${siteKey} between ${period} and ${end} — cloud or publication lag, not darkness`,
    };
  }

  // THE RETRIEVAL GATE (Reality Check PR-1). A confident_clear night is only
  // a look if it carries a retrieval: radiance_3x3 is NULL when no pixel of
  // the 3x3 window had a high-quality retrieval that night (mig 091), and
  // Number(null) is 0 — so before this gate a cloud-clear night with no
  // retrieval was scored as a dark night. 2,534 confident_clear refinery
  // nights through 2026-09-08 carry no radiance_3x3. Zero itself is a real
  // measurement (18 genuine zeros) and stays a look.
  const looked = clear.filter((r) => retrieval(r.radiance_3x3) !== null);
  if (looked.length === 0) {
    return {
      observed: 0,
      source_url: '/intel/calibration',
      void_reason: `${clear.length} confident_clear night(s) for site ${siteKey} between ${period} and ${end}, none carrying a radiance_3x3 retrieval — not looked, not darkness`,
    };
  }

  const lit = looked.some((r) => (retrieval(r.radiance_3x3) as number) >= threshold);
  return { observed: lit ? 1 : 0, source_url: '/intel/calibration' };
};

type ClearNight = { radiance_3x3: number | string | null; period: string };

/** The retrieved radiance, or null when the night carries no retrieval. Never 0 for missing. */
function retrieval(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** site_key is `round(lat,4):round(lon,4)`; reverse-map by a bounded box, never float equality. */
async function facilitiesAtSite(siteKey: string, supabase: SupabaseAny): Promise<string[] | null> {
  const [latRaw, lonRaw] = siteKey.split(':');
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const eps = 0.00005;
  const { data, error } = await supabase
    .from('firms_monitored_facilities')
    .select('facility_id')
    .gte('latitude', lat - eps).lte('latitude', lat + eps)
    .gte('longitude', lon - eps).lte('longitude', lon + eps);
  if (error) return null;
  return (data ?? []).map((r: { facility_id: string }) => r.facility_id);
}
