import type { Resolver, SupabaseAny } from './types';

/**
 * FIRMS went_dark recovery resolver (machine track, mig 127).
 *
 * Resolves from firms_facility_observations, which exists IFF WE LOOKED
 * (mig 085). That is the whole reason this family is honest:
 *
 *   any detection in the window   -> observed = 1  (re-detected)
 *   covered, no detection         -> observed = 0  (still dark)
 *   NOT COVERED                   -> VOID
 *
 * The third case is the one that matters. A site we did not observe is not a
 * site that stayed dark — cloud and overpass timing both suppress detections,
 * and scoring silence as a negative is how the EIA family recorded a 0.000
 * base rate for an event that happens ~69% of the time.
 *
 * LOOKUP IS BY CONTEXT, NOT BY PARSING target_observable. #465 cost 450
 * fabricated voids because the dark-contact resolver rebuilt a lookup key from
 * a serialised millisecond timestamp and missed a microsecond column every
 * time. site_key and flagged_period are written onto the claim at issue; they
 * are what this reads. The observable stays a dedup key and nothing more.
 */

type Ctx = { site_key?: unknown; flagged_period?: unknown; horizon_days?: unknown };

export const resolveFirmsRecovery: Resolver = async (row, supabase) => {
  const ctx = (row.context ?? {}) as Ctx;
  const siteKey = typeof ctx.site_key === 'string' ? ctx.site_key : null;
  const period = typeof ctx.flagged_period === 'string' ? ctx.flagged_period : null;
  const horizon = Number(ctx.horizon_days);
  if (!siteKey || !period || !Number.isFinite(horizon)) {
    // Malformed claims are not evidence about the world. VOID rather than
    // guess a direction.
    return {
      observed: 0,
      source_url: '/intel/calibration',
      void_reason: `firms recovery claim missing site_key/flagged_period/horizon_days`,
    };
  }

  const facilityIds = await facilitiesAtSite(siteKey, supabase);
  if (facilityIds === null) return null;              // lookup failed — retry, never assume
  if (facilityIds.length === 0) {
    return {
      observed: 0,
      source_url: '/intel/calibration',
      void_reason: `no monitored facility resolves to site ${siteKey}`,
    };
  }

  const end = new Date(Date.parse(`${period}T00:00:00Z`) + horizon * 86_400_000)
    .toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('firms_facility_observations')
    .select('detection_count')
    .in('facility_id', facilityIds)
    .gt('period', period)
    .lte('period', end);

  if (error) return null;                              // transient — retry next tick

  const rows = data ?? [];
  if (rows.length === 0) {
    // Covered nothing. Never a win, never a loss.
    return {
      observed: 0,
      source_url: '/intel/calibration',
      void_reason: `site ${siteKey} was not observed between ${period} and ${end} — no clear look`,
    };
  }

  const redetected = rows.some((r: { detection_count: number | null }) => Number(r.detection_count) >= 1);
  return { observed: redetected ? 1 : 0, source_url: '/intel/calibration' };
};

/**
 * site_key is `round(lat,4):round(lon,4)`, so the reverse map is a rounded
 * coordinate match. Bounded to a tight box rather than an equality on a
 * float — comparing doubles for equality is the same class of mistake as
 * comparing a millisecond key to a microsecond column.
 */
async function facilitiesAtSite(siteKey: string, supabase: SupabaseAny): Promise<string[] | null> {
  const [latRaw, lonRaw] = siteKey.split(':');
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const eps = 0.00005;   // half of the 4-decimal rounding step

  const { data, error } = await supabase
    .from('firms_monitored_facilities')
    .select('facility_id')
    .gte('latitude', lat - eps).lte('latitude', lat + eps)
    .gte('longitude', lon - eps).lte('longitude', lon + eps);

  if (error) return null;
  return (data ?? []).map((r: { facility_id: string }) => r.facility_id);
}
