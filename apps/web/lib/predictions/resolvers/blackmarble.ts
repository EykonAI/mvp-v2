import type { Resolver, SupabaseAny } from './types';

/**
 * Black Marble resolver (machine track, mig 128) for both night-lights
 * families.
 *
 *   a clear night at or above the frozen threshold -> observed = 1
 *   clear nights, none reaching it                 -> observed = 0
 *   NO confident_clear night in the window         -> VOID
 *
 * The third case is the whole reason this sensor can be trusted. Only 43% of
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

  const { data, error } = await supabase
    .from('blackmarble_facility_radiance')
    .select('radiance_3x3, period')
    .in('facility_id', facilityIds)
    .eq('cloud_confidence', 'confident_clear')   // the only readings that mean anything
    .gt('period', period)
    .lte('period', end);

  if (error) return null;

  const clear = data ?? [];
  if (clear.length === 0) {
    // Either cloud, or the ~13-day publication lag has not reached this window
    // yet. Both are "we did not look", and neither is darkness.
    return {
      observed: 0,
      source_url: '/intel/calibration',
      void_reason: `no confident_clear night for site ${siteKey} between ${period} and ${end} — cloud or publication lag, not darkness`,
    };
  }

  const lit = clear.some((r: { radiance_3x3: number | null }) => Number(r.radiance_3x3) >= threshold);
  return { observed: lit ? 1 : 0, source_url: '/intel/calibration' };
};

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
