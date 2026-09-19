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
  /**
   * Wired analyst tools. Not "defined" — wired: every entry in CLAUDE_TOOLS
   * has a matching case in lib/tool-executor.ts, so a tool counted here is one
   * a user can actually make fire.
   *   grep -cE "^\s+name: '[a-z_]+'," lib/anthropic.ts            -> 24
   *   grep -cE "^\s+case '[a-z_]+':"  lib/tool-executor.ts        -> 24
   * The two sets are identical — scripts/marketing/check-tool-count.mjs
   * asserts that on every CI run, and asserts this constant matches them.
   * Verified 2026-09-05 on main @ 98017c2.
   *
   * This figure has now been wrong in BOTH directions: #441 corrected an
   * overcount, then query_dark_contact_events landed and made 23 an
   * undercount. Do not hand-edit it — change a tool, run the check.
   */
  analystTools: 24,

  /** select count(distinct theatre_slug) from posture_scores where computed_at > now() - interval '24 hours' */
  postureTheatres: 6,

  /**
   * select count(*) from refineries — the REGISTRY, not the watched set.
   * Quote it only with a registry verb ("634 refineries" in the globe
   * sentence, showcase-slides.ts). The WATCHED figure is deliberately NOT a
   * constant here — it moves when a box widens or a site is re-typed, so it
   * is computed at request time by the named query in
   * lib/marketing/watched-coverage.ts (refineriesWatched) and rendered from
   * that. Since migration 168 it counts crude-oil refineries only
   * (site_type = 'refinery'): 353 inside the boxes once 168 and the 74 E
   * ru-ua box are live (431 refinery-tagged rows on 2026-09-18, before).
   * "634 refineries watched" was the defect (Reality Check rev H, PR-10).
   * NOTE: after 168 this registry literal is itself stale — 650 rows, of
   * which 554 are site_type = 'refinery' — and is left for a copy decision.
   */
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

  // nightLightsFacilities (10,556) was removed 2026-09-18 (rev H, PR-10). Its
  // own query no longer reproduced it (10,412 on the night of 09-09), and the
  // figure counted generating-unit ROWS as "facilities" — 10,125 power rows sit
  // on 5,808 locations. The night-lights figure is now computed per request by
  // lib/marketing/watched-coverage.ts (nightlightsClearReadings: confident-clear
  // readings with a retrieval on the newest published night).
} as const;

/** Thousands separators, so 182417 reads as 182,417 in copy. */
export function stat(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * The founding-cohort figure is rendered only once it clears this floor.
 *
 * Below it the number argues against us: it reads as "nobody uses this" on the
 * one page whose job is credibility. Live on 2026-09-01 it stood at roughly 39
 * — 36 registered users plus 4 closing_leads — and per the onboarding brief all
 * /start traffic to date has been the founder and two agent probes, so those 4
 * are test rows rather than prospects.
 *
 * Two things this must never do: count the fiat_waitlist rows (all 25 are
 * unsubscribed farmed bot rows — the admin view says "25 on this list reserve
 * nothing"), and render a hardcoded fallback. The homepage previously shipped a
 * fabricated seat count of 847 that rendered while the live counter loaded; it
 * was removed in #368. Below the floor the figure is simply absent.
 *
 * Founder decision 2026-09-01: ship the band with the seat counter alone and
 * let this appear on its own once it clears. Raise or lower the floor freely —
 * it is one number, and nothing else depends on it.
 */
export const COHORT_DISPLAY_FLOOR = 250;
