/**
 * Platform figures quoted on the marketing surface.
 *
 * The landing page tells the reader "Don't trust us. Audit us." Everything in
 * this file is therefore a number an auditor can reproduce, with the query that
 * produces it and the date it was last run. One file to check, one place to be
 * wrong.
 *
 * Rules for anything added here:
 *   1. Quote the exact figure, not a rounded one. Rounding is where drift hides,
 *      and "634" survives an audit that "~700" fails.
 *   2. If the number is a subset, SAY WHICH SUBSET in the copy. An unlabelled
 *      subset is the failure mode this platform's engineering discipline exists
 *      to prevent.
 *   3. Re-run the query before changing the copy. Several of these move.
 *
 * All verified 2026-09-01 against production.
 */

export const PLATFORM_STATS = {
  /** lib/anthropic.ts CLAUDE_TOOLS — count the entries, they are the contract. */
  analystTools: 23,

  /** select count(distinct theatre_slug) from posture_scores where computed_at > now() - interval '24 hours' */
  postureTheatres: 6,

  /** select count(*) from refineries */
  refineries: 634,

  /** select count(*) from ports */
  seaports: 3803,

  /** select count(*) from mines */
  mineralDeposits: 304613,

  /**
   * power_plants is UNIT-level, so both numbers are real and they are not the
   * same thing. The page quotes both rather than picking one and implying the
   * other.
   *   select count(*) from power_plants                      -> 182417
   *   select count(distinct plant_name) from power_plants     -> 145097
   */
  powerPlantUnits: 182417,
  powerPlants: 145097,

  /**
   * airports holds 85,254 rows, but 13,159 of those are type='closed' and 61
   * are balloonports. Quoting the raw count would present closed airfields as
   * live infrastructure, so the figure excludes them and the copy says so.
   *   select count(*) from airports where type <> 'closed'   -> 72095
   * For reference: 4,423 have scheduled_service='yes'; 5,276 are large or
   * medium. If the copy ever needs a smaller, punchier number, use one of those
   * and name the filter.
   */
  airfields: 72095,

  /** select count(*) from entities — OFAC actor graph, rebuilt Mondays 03:00 UTC */
  ofacEntities: 2140,

  /**
   * select count(distinct facility_id) from blackmarble_facility_radiance
   * where period = (select max(period) from blackmarble_facility_radiance)
   */
  nightLightsFacilities: 10556,
} as const;

/** Thousands separators, so 182417 reads as 182,417 in copy. */
export function stat(n: number): string {
  return n.toLocaleString('en-US');
}
