-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 166 · Stop sampling dead ground
--             (Reality Check programme, build prompt rev H, Wave 2, PR-3)
--
-- WHAT CHANGES — one predicate in one CTE, nothing else
-- firms_derive_facility_observations() writes one row per watched facility
-- per day into firms_facility_observations. Its `monitored` CTE is the
-- sensor roster of BOTH instruments: the Black Marble worker samples every
-- facility FIRMS observed in the last BM_ROSTER_DAYS (5) days, so a site that
-- stops getting FIRMS rows leaves the night-lights roster five days later.
--
-- Today the power branch is every GEM unit >= 500 MW with a geometry,
-- whatever its status. 10,125 power rows a night, 5,079 of them at sites
-- where NOTHING operates — announced, pre-construction, construction,
-- cancelled, shelved, mothballed or retired units whose site has no
-- operating unit of any size. That is dead ground: a heat or light reading
-- there is a reading of a field, not of a plant.
--
-- The rule (conservative "dead ground" reading):
--   keep a power unit when its site (gem_location_id) has at least one unit
--   with status = 'operating', of ANY capacity. Remove the site otherwise.
-- Refineries: unchanged, all of them. The capacity floor, the geometry
-- test, the region test, the radius, the detection join, the upsert and
-- everything mig 164 (PR-12) put in the body — twin linking, canonical
-- records, twins_excluded — are not touched.
--
-- HOW — mig 164's body, plus one predicate
-- Mig 164 (PR-12, FIRMS twin guard) replaces this same function and is
-- applied FIRST. §1 below is 164's body, copied verbatim from
-- origin/feat/rc-pr12-firms-twin-guard at 2792834 (re-checked at 24659b8,
-- whose change is comments only; md5(prosrc)
-- 62b04fa280ef9a63e95ffea3b4618f04, the value 164's own guard and VERIFY
-- use), with only the 166 predicate inserted after
-- `AND p.capacity_mw >= p_min_mw` in the power branch of `monitored`.
-- Diff it against 164: that insertion is the whole change. The result is
-- md5 c4296bdc42502ae41f1e364476784099.
--
-- §0 is the guard. It refuses to replace any body except 164's (first run)
-- or this file's own (re-run):
--   • mig 085's body (d3de0425…)  → 164 has not been applied. Apply 164
--     first; never apply 166 without it (166 would silently undo the twin
--     guard, and 164 would then refuse to run over 166).
--   • any other body              → 164 (or something else) changed the
--     function after 2792834. STOP. Re-sync 166: copy the live body, insert
--     the same predicate, update both md5s. Never edit the md5 to force it.
-- After the CREATE OR REPLACE a second check proves the installed body is
-- exactly c4296bdc…; otherwise the whole transaction rolls back.
--
-- NOT CHANGED, on purpose:
--   • firms_monitored_facilities (the view). The 086 proximity tag/prune and
--     every resolver's site lookup read it; narrowing it would prune raw
--     detections and break site lookup for claims already issued.
--   • firms_tag_facility_proximity / firms_prune_thermal_anomalies. The raw
--     retention tier still keeps detections near every >= 500 MW unit.
--   • Rows already written. No history is deleted.
--
-- THE TRANSITION: a day already started is finished, never abandoned.
-- The ingest re-derives today and yesterday every hour. Without the last
-- OR-branch of the predicate, the rows a removed site already has for those
-- two days would freeze at whatever the last pre-cut run counted — a
-- partial day stored as a full-day look, the exact dishonesty mig 085
-- exists to prevent. With it, a removed site keeps being re-derived on any
-- day it ALREADY has a row for, and no new day is ever started for it. It
-- cannot perpetuate itself: a day with no row never gets one.
--
-- MEASURED 2026-09-18 (supabase-ro; the covered roster reproduces
-- firms_facility_observations for 2026-09-17 exactly, 0 rows either way):
--   nightly rows            10,556 = 431 refineries + 10,125 power units
--   this rule (chosen)       5,477 = 431 + 5,046        −5,079  −48.1 %
--   build prompt (a)         5,071 = 431 + 4,640        −5,485  −52.0 %
--   build prompt (b)         3,842 = 431 + 3,411        −6,714  −63.6 %
--   (a) judges "operating" over the >= 500 MW units only. It also removes
--   406 unit rows at 246 sites whose operating units are all < 500 MW —
--   and those rows ran an 11.0 % FIRMS detection-day rate over 08-18..09-16,
--   ABOVE the 9.3 % of the combustion sites every rule keeps. That is live
--   ground, so this migration keeps it. The rows it does remove ran 2.8 %.
--   Residual shared by this rule and (a): a GEM location can span a whole
--   complex, so 49 kept non-operating units in the boxes sit > 5 km from
--   every operating unit of their location (mostly announced / pre-
--   construction desert wind and solar phases in Inner Mongolia, up to
--   179 km away). They are sampled as before; a distance test would be a
--   new rule, not this one.
--   Black Marble: 84 → 79 tiles a night, 10,556 → 5,477 rows.
--   Refineries: 431 of 431 kept (the refinery branch is untouched).
--   R-1 CEMS cohort (watched ∩ United States ∩ operating ∩ coal / oil/gas /
--   bioenergy): 582 unit rows at 401 plants, all >= 500 MW, every one kept,
--   facility_id = power_plants.id unchanged (an operating unit's own site
--   is operating by definition).
--   Derive cost: the covered set halves; the read side measured 2.07 s →
--   1.43 s on 2026-09-17's detections, and the upsert halves. Context: over
--   the last 24 h, 102 of 238 derive RPC calls returned HTTP 500 (8 s
--   statement_timeout; pg_stat_statements mean 4.39 s, max 8.00 s).
--
-- WHAT THIS DOES TO CLAIMS (machine track; see the PR body for the table)
--   Claims resolve from these rows, so the sites removed here stop producing
--   evidence. Resolvers VOID a window with no look at all
--   (firms-recovery: "was not observed"; blackmarble: "no confident_clear
--   night"; data-clock stale guard) — never a miss. A window that straddles
--   the cut resolves on the days/nights that WERE looked at: for Black Marble
--   that is what a cloud-truncated window gets today; for FIRMS it is new —
--   a firms_went_dark_recovery claim flagged the day or two before the cut is
--   judged on 1–2 of its 3 days (PR body: a founder decision). Future
--   issuance at dead ground stops: 85 % of all
--   nightlights_first_light_persistence claims ever issued sat at sites this
--   rule removes (251 of 296), 24 % of firms_went_dark_recovery (37 of 154)
--   and 25 % of nightlights_recovery (14 of 56). The change is recorded in
--   ledger_change_log (§3) because it changes those families' population
--   mid-series.
--
-- DEPENDS ON (apply in number order):
--   • 164 (PR-12, FIRMS twin guard) — HARD. It must be applied before this
--     file; §0 raises otherwise. If 164 is revised after 2792834 in a way
--     that changes its rollup body, §0 stops this file and 166 must be
--     re-synced onto the new body before it is applied.
--   • 158–163 and 165 applied first, as for every migration in the
--     programme (apply order only; no object of theirs is read here).
--   • PR-10's code merged and deployed first. The cut takes effect when this
--     file is applied, not when PR-3 merges, and several live pages still
--     print the pre-cut literal (10,556 facilities) until PR-10 renders the
--     watched count from the newest rows.
--   • After this file, re-running 164 stops at 164's §0 and 164's VERIFY
--     row 14 reads false: both expected (the live body is 164 + 166).
--   • The census acceptance (supabase/tests/pr3_guards.sql, watch items
--     C2/C3) reads sensor_night_census, created by 159 (PR-1).
--
-- Idempotent: a re-run finds this file's own body, replaces it with the
-- identical body and changes nothing; grants re-asserted; change-log row
-- keyed on the PR. No temp tables, no session state, no data deleted.
-- Apply MANUALLY in the Supabase SQL Editor — the whole file — BEFORE merge.
-- Nothing on Railway: the ingest route's RPC call is unchanged.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 0 · Refuse to replace any body but 164's (or this file's own) ─────
DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.firms_derive_facility_observations(date, numeric, numeric, jsonb)');

  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '166: firms_derive_facility_observations(date, numeric, numeric, jsonb) not found — nothing to change';
  ELSIF v_md5 = 'd3de0425a39ec36875e76106a47f85f5' THEN
    RAISE EXCEPTION '166: the live rollup body is still mig 085''s — mig 164 (PR-12, FIRMS twin guard) has not been applied. Apply 164 first, then re-run 166. Do not force.';
  ELSIF v_md5 NOT IN ('62b04fa280ef9a63e95ffea3b4618f04',    -- mig 164 (PR-12 at 2792834)
                      'c4296bdc42502ae41f1e364476784099') THEN -- this file (re-run)
    RAISE EXCEPTION '166: the live rollup body (md5 %) is neither mig 164''s (62b04fa2…) nor 166''s own (c4296bdc…). 164 or another migration changed it after 2792834 — re-sync 166 onto the live body. Do not edit the md5 to force it.', v_md5;
  END IF;
  RAISE NOTICE '166: base body md5 % (%) — replacing', v_md5,
    CASE v_md5 WHEN '62b04fa280ef9a63e95ffea3b4618f04' THEN 'mig 164' ELSE 'mig 166, re-run' END;
END
$guard$;

-- ─── 1 · Rollup — mig 164's body plus the 166 predicate ───────────────
-- Same signature, defaults, region gate, twin linking, canonical-record
-- aggregation, coverage semantics and return value as mig 164. The only
-- change is the block marked "mig 166" in the power branch of `monitored`.
CREATE OR REPLACE FUNCTION public.firms_derive_facility_observations(
  p_day       date,
  p_radius_km numeric DEFAULT 5,
  p_min_mw    numeric DEFAULT 500,
  p_regions   jsonb   DEFAULT NULL
) RETURNS int AS $$
DECLARE
  v_rows int;
BEGIN
  IF p_regions IS NULL OR jsonb_array_length(p_regions) = 0 THEN
    -- Fail closed AND LOUD. Returning 0 here would be worse than
    -- useless: the caller reports a successful run that wrote
    -- nothing, which is the silent-no-op failure mode this whole
    -- feature exists to prevent. A caller that forgets its regions
    -- must go red, not green-with-no-data.
    RAISE EXCEPTION 'firms_derive_facility_observations: p_regions is required (declared coverage cannot be empty)';
  END IF;

  -- 164 · Link this day's twins BEFORE reading it, in the same
  -- transaction, so the rollup can never read an unlinked day.
  PERFORM public.firms_link_twins(p_day, p_day);

  WITH monitored AS (
    SELECT 'refinery'::text AS facility_type,
           r.id::text       AS facility_id,
           r.refinery_name  AS facility_name,
           r.country,
           r.geom,
           r.latitude, r.longitude
      FROM refineries r
     WHERE r.geom IS NOT NULL
    UNION ALL
    SELECT 'power_plant'::text,
           p.id::text,
           p.plant_name,
           p.country,
           p.geom,
           p.latitude, p.longitude
      FROM power_plants p
     WHERE p.geom IS NOT NULL
       AND p.capacity_mw >= p_min_mw
       -- mig 166 (Reality Check PR-3): stop sampling dead ground.
       -- A unit is sampled when its SITE has an operating unit of any
       -- capacity. The key stays power_plants.id (R-1: the CEMS join).
       AND (
             p.status = 'operating'
          OR p.gem_location_id IS NULL          -- site unknown: keep, never guess
          OR p.gem_location_id IN (
               SELECT o.gem_location_id
                 FROM power_plants o
                WHERE o.status = 'operating'
                  AND o.gem_location_id IS NOT NULL)
          -- A day already started is finished, never abandoned: a
          -- removed site keeps being re-derived on a day it already
          -- has a row for, so its last rows are complete looks, not
          -- frozen partial ones. No new day is ever started for it.
          OR EXISTS (
               SELECT 1
                 FROM firms_facility_observations x
                WHERE x.facility_type = 'power_plant'
                  AND x.facility_id   = p.id::text
                  AND x.period        = p_day)
           )
  ),
  covered AS (
    SELECT * FROM monitored m
     WHERE firms_point_in_regions(m.latitude, m.longitude, p_regions)
  ),
  day_detections AS (
    SELECT f.id, f.frp, f.geom,
           (f.twin_of IS NOT NULL) AS superseded
      FROM firms_thermal_anomalies f
     WHERE f.acq_date = p_day
       AND f.geom IS NOT NULL
  ),
  hits AS (
    -- 164 · A twin pair counts ONCE, at its later-filed record: the
    -- superseded half is counted in twins_excluded and nowhere else.
    SELECT c.facility_type,
           c.facility_id,
           COUNT(*) FILTER (WHERE NOT d.superseded)                          AS detection_count,
           MAX(d.frp) FILTER (WHERE NOT d.superseded)                        AS max_frp,
           MIN(ST_Distance(c.geom::geography, d.geom::geography))
             FILTER (WHERE NOT d.superseded) / 1000.0                        AS nearest_km,
           COUNT(*) FILTER (WHERE d.superseded)                              AS twins_excluded
      FROM day_detections d
      JOIN covered c
        ON ST_DWithin(c.geom::geography, d.geom::geography, p_radius_km * 1000)
     GROUP BY 1, 2
  )
  INSERT INTO firms_facility_observations (
    facility_type, facility_id, facility_name, country,
    period, detection_count, max_frp, nearest_km, radius_km, computed_at,
    twins_excluded
  )
  SELECT c.facility_type, c.facility_id, c.facility_name, c.country,
         p_day,
         COALESCE(h.detection_count, 0),
         h.max_frp, h.nearest_km, p_radius_km, now(),
         COALESCE(h.twins_excluded, 0)
    FROM covered c
    LEFT JOIN hits h
      ON h.facility_type = c.facility_type
     AND h.facility_id   = c.facility_id
  ON CONFLICT (facility_type, facility_id, period) DO UPDATE
    SET detection_count = EXCLUDED.detection_count,
        max_frp         = EXCLUDED.max_frp,
        nearest_km      = EXCLUDED.nearest_km,
        radius_km       = EXCLUDED.radius_km,
        twins_excluded  = EXCLUDED.twins_excluded,
        computed_at     = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql;

-- The installed body must be exactly the one above (a paste that changed
-- a byte, or a stray edit, rolls the whole file back).
DO $check$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.firms_derive_facility_observations(date, numeric, numeric, jsonb)');
  IF v_md5 IS DISTINCT FROM 'c4296bdc42502ae41f1e364476784099' THEN
    RAISE EXCEPTION '166: installed body md5 % is not the 164 + 166 body (c4296bdc…) — rolled back', v_md5;
  END IF;
  IF to_regprocedure('public.firms_derive_facility_observations(date, numeric, numeric)') IS NOT NULL THEN
    RAISE EXCEPTION '166: a stale 3-argument overload exists (mig 085 dropped it) — rolled back';
  END IF;
  RAISE NOTICE '166: installed body md5 % (164 + 166)', v_md5;
END
$check$;

COMMENT ON FUNCTION public.firms_derive_facility_observations(date, numeric, numeric, jsonb) IS
  'Per-facility daily FIRMS rollup (mig 085; twin guard mig 164; roster mig 166). This rollup is the sensor roster of FIRMS and Black Marble (the BM worker samples what FIRMS observed in the last 5 days). Mig 166 (Reality Check PR-3): the power branch samples a >= 500 MW unit only when the unit''s site (gem_location_id) has an operating unit of any capacity — dead ground is no longer sampled — and keeps re-deriving a removed site only on a day it already has a row for. Refineries unchanged. Heavy: called per day by /api/cron/ingest-firms.';

-- ─── 2 · Grants, re-asserted by role name (mig 143 / 139 lesson) ───────
REVOKE EXECUTE ON FUNCTION public.firms_derive_facility_observations(date, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.firms_derive_facility_observations(date, numeric, numeric, jsonb) TO service_role;

-- ─── 3 · On the record (mig 137 pattern; idempotent on the PR) ─────────
-- It changes the population three machine families issue on, so it is a
-- change-log row, not a silent change (build prompt D-5). `at` is also the
-- cut timestamp the dated watch items in supabase/tests/pr3_guards.sql read.
INSERT INTO public.ledger_change_log (at, pr, note)
SELECT now(), '#531', 'sensor roster: FIRMS and night-lights stop sampling power sites with no operating unit (10,556 → 5,477 facility rows a night; refineries unchanged) — first_light and recovery families issue on the remaining sites only'
WHERE NOT EXISTS (SELECT 1 FROM public.ledger_change_log WHERE pr = '#531');

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only, ONE row. Run with the file (it is the last statement,
-- so the SQL Editor shows it) and paste the row back. Expect:
--   body '164 + 166' · twin_linking true · anon_exec false ·
--   authenticated_exec false · service_role_exec true ·
--   stale_3arg_overload false · change_log_rows 1 · roster_refinery 431 ·
--   roster_power 5046 · roster_total 5477 · rows_removed_pct 48.1 ·
--   refineries_dropped 0 · cems_rows 582 · cems_plants 401 · cems_min_mw 500 ·
--   cems_in_roster 582 · cems_bm_rows_on_power_plants_id 582
-- The roster columns apply the SAME predicate as §1 (a mirror, stated as
-- such); the behavioural test that calls the function itself is
-- supabase/tests/pr3_guards.sql (E1–E5, G1–G5). The region boxes mirror
-- FIRMS_REGIONS (apps/web/lib/firms/client.ts, origin/main 0b0d4b1, 8
-- boxes); if PR-11 has widened ru-ua east first, roster_power and
-- roster_total move by that box's operating sites. cems_bm_rows_* reads the
-- newest complete Black Marble night, which at apply time predates the cut;
-- the post-cut R-1 check is watch item C3b in the guard script.
-- ═══════════════════════════════════════════════════════════════════════
WITH fn AS (
  SELECT p.oid, p.prosrc
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.firms_derive_facility_observations(date, numeric, numeric, jsonb)')
),
regions AS (
  SELECT '[{"west":22,"south":44,"east":60,"north":62},{"west":44,"south":22,"east":60,"north":34},{"west":-10,"south":35,"east":22,"north":60},{"west":100,"south":18,"east":146,"north":46},{"west":60,"south":5,"east":100,"north":37},{"west":95,"south":-11,"east":142,"north":20},{"west":-100,"south":24,"east":-52,"north":55},{"west":-130,"south":25,"east":-100,"north":55}]'::jsonb AS j
),
op_sites AS (
  SELECT DISTINCT gem_location_id FROM power_plants
   WHERE status = 'operating' AND gem_location_id IS NOT NULL
),
roster AS (          -- mirror of §1 for a day not yet started
  SELECT 'refinery'::text AS facility_type, r.id::text AS facility_id
    FROM refineries r, regions g
   WHERE r.geom IS NOT NULL
     AND firms_point_in_regions(r.latitude, r.longitude, g.j)
  UNION ALL
  SELECT 'power_plant', p.id::text
    FROM power_plants p, regions g
   WHERE p.geom IS NOT NULL AND p.capacity_mw >= 500
     AND (p.status = 'operating' OR p.gem_location_id IS NULL
          OR p.gem_location_id IN (SELECT gem_location_id FROM op_sites))
     AND firms_point_in_regions(p.latitude, p.longitude, g.j)
),
before_cut AS (      -- the roster FIRMS wrote the day before the cut (complete: see §1)
  SELECT o.facility_type, o.facility_id
    FROM firms_facility_observations o
   WHERE o.period = COALESCE(
           (SELECT (at AT TIME ZONE 'UTC')::date - 1 FROM public.ledger_change_log WHERE pr = '#531'),
           (SELECT max(period) - 1 FROM firms_facility_observations))
),
cohort AS (          -- R-1: watched ∩ US ∩ operating ∩ coal / oil/gas / bioenergy
  SELECT p.id, p.gem_location_id, p.capacity_mw
    FROM before_cut b
    JOIN power_plants p ON p.id = b.facility_id
   WHERE b.facility_type = 'power_plant'
     AND p.status = 'operating'
     AND p.fuel_type IN ('coal', 'oil/gas', 'bioenergy')
     AND p.country = 'United States'
),
bm_night AS (        -- newest complete Black Marble night
  SELECT max(night) AS n FROM blackmarble_ingest_runs
   WHERE tiles_expected > 0 AND tiles_processed = tiles_expected
     AND tiles_missing = 0 AND facilities_written > 0
)
SELECT
  (SELECT CASE md5(prosrc) WHEN 'c4296bdc42502ae41f1e364476784099' THEN '164 + 166'
                           WHEN '62b04fa280ef9a63e95ffea3b4618f04' THEN '164, 166 NOT applied'
                           WHEN 'd3de0425a39ec36875e76106a47f85f5' THEN '085, 164 and 166 NOT applied'
                           ELSE 'other: ' || md5(prosrc) END FROM fn)            AS body,
  (SELECT prosrc LIKE '%firms_link_twins%' FROM fn)                              AS twin_linking,
  (SELECT has_function_privilege('anon',          oid, 'EXECUTE') FROM fn)       AS anon_exec,
  (SELECT has_function_privilege('authenticated', oid, 'EXECUTE') FROM fn)       AS authenticated_exec,
  (SELECT has_function_privilege('service_role',  oid, 'EXECUTE') FROM fn)       AS service_role_exec,
  to_regprocedure('public.firms_derive_facility_observations(date, numeric, numeric)') IS NOT NULL
                                                                                 AS stale_3arg_overload,
  (SELECT count(*) FROM public.ledger_change_log WHERE pr = '#531')            AS change_log_rows,
  (SELECT count(*) FROM roster WHERE facility_type = 'refinery')                 AS roster_refinery,
  (SELECT count(*) FROM roster WHERE facility_type = 'power_plant')              AS roster_power,
  (SELECT count(*) FROM roster)                                                  AS roster_total,
  (SELECT round(100.0 * (1 - (SELECT count(*) FROM roster)::numeric / NULLIF(count(*), 0)), 1)
     FROM before_cut)                                                            AS rows_removed_pct,
  (SELECT count(*) FROM before_cut b
    WHERE b.facility_type = 'refinery'
      AND NOT EXISTS (SELECT 1 FROM roster r
                       WHERE r.facility_type = 'refinery' AND r.facility_id = b.facility_id))
                                                                                 AS refineries_dropped,
  (SELECT count(*) FROM cohort)                                                  AS cems_rows,
  (SELECT count(DISTINCT gem_location_id) FROM cohort)                           AS cems_plants,
  (SELECT min(capacity_mw) FROM cohort)                                          AS cems_min_mw,
  (SELECT count(*) FROM cohort c
    WHERE EXISTS (SELECT 1 FROM roster r
                   WHERE r.facility_type = 'power_plant' AND r.facility_id = c.id))
                                                                                 AS cems_in_roster,
  (SELECT count(*) FROM blackmarble_facility_radiance b, bm_night
    WHERE b.period = bm_night.n AND b.facility_type = 'power_plant'
      AND b.facility_id IN (SELECT id FROM cohort))                              AS cems_bm_rows_on_power_plants_id;
