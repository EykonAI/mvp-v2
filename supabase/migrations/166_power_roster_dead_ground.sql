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
-- test, the region test, the radius, the detection join, the upsert — and
-- whatever mig 164 (PR-12) put in the body — are not touched.
--
-- HOW — an insertion into the LIVE body, not a rewrite of it
-- This function is replaced by two in-flight migrations: 164 (PR-12, FIRMS
-- twin guard: links twins first, aggregates canonical records, writes
-- twins_excluded) and this one. Apply order is 164 then 166. Rather than
-- carry a copy of 164's body (which is still a draft and may change),
-- §1 reads the live definition (pg_get_functiondef), finds the power
-- branch of `monitored` — the same three lines in mig 085 and in mig 164 —
-- and inserts the 166 predicate after it. It refuses unless that branch
-- occurs exactly once, and after the CREATE OR REPLACE it proves the new
-- body is the old body plus the insertion and nothing else (else the
-- transaction rolls back). Measured 2026-09-18: the insertion into the live
-- (085) body gives md5 970b5efc72895bbaeb6356d36fa3f896; into the PR-12
-- draft's 164 body (5bce85e) it gives c4296bdc42502ae41f1e364476784099.
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
--   • 158–165 applied first, as for every migration in the programme.
--   • 164 (PR-12, FIRMS twin guard) replaces this same function. §1 inserts
--     into whatever body is live, so 166 applies on 164's body (or on 085's
--     if 164 has not landed). Order matters the other way: if 164 were
--     applied AFTER 166, 164's own guard stops it (its body md5 check) — do
--     not force 164 over 166; re-run 166 after 164 instead (§1 re-inserts).
--   • The census acceptance (supabase/tests/pr3_guards.sql, watch items
--     C2/C3) reads sensor_night_census, created by 159 (PR-1).
--
-- Idempotent: a re-run finds the predicate already in place and changes
-- nothing; grants re-asserted; change-log row keyed on the PR. No temp
-- tables, no session state, no data deleted.
-- Apply MANUALLY in the Supabase SQL Editor — the whole file — BEFORE merge.
-- Nothing on Railway: the ingest route's RPC call is unchanged.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1 · Insert the predicate into the live body; change nothing else ──
DO $patch$
DECLARE
  c_sig    constant text := 'public.firms_derive_facility_observations(date, numeric, numeric, jsonb)';
  -- The power branch of `monitored`, identical in mig 085 and mig 164.
  -- The predicate goes between c_head and c_tail.
  c_head   constant text := $h$      FROM power_plants p
     WHERE p.geom IS NOT NULL
       AND p.capacity_mw >= p_min_mw
$h$;
  c_tail   constant text := $t$  ),
  covered AS ($t$;
  c_insert constant text := $i$       -- mig 166 (Reality Check PR-3): stop sampling dead ground.
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
$i$;
  c_marker constant text := 'mig 166 (Reality Check PR-3)';
  c_note   constant text := 'Mig 166 (Reality Check PR-3): this rollup is the sensor roster of FIRMS and Black Marble (the BM worker samples what FIRMS observed in the last 5 days). Its power branch samples a >= 500 MW unit only when the unit''s site (gem_location_id) has an operating unit of any capacity — dead ground is no longer sampled — and keeps re-deriving a removed site only on a day it already has a row for. Refineries unchanged. Heavy: called per day by /api/cron/ingest-firms.';
  v_oid    oid;
  v_old    text;
  v_def    text;
  v_new    text;
  v_n      int;
  v_cmt    text;
BEGIN
  v_oid := to_regprocedure(c_sig);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '166: % not found — nothing to change', c_sig;
  END IF;
  SELECT p.prosrc INTO v_old FROM pg_proc p WHERE p.oid = v_oid;

  IF position(c_marker IN v_old) > 0 THEN
    -- Re-run. The exact predicate must still sit in the power branch.
    IF position(c_head || c_insert || c_tail IN v_old) = 0 THEN
      RAISE EXCEPTION '166: the live body carries the 166 marker but not the exact 166 predicate in the power branch (body md5 %). It was edited after 166 — stop; do not force.', md5(v_old);
    END IF;
    RAISE NOTICE '166: predicate already in place (body md5 %) — function unchanged', md5(v_old);
  ELSE
    v_n := (length(v_old) - length(replace(v_old, c_head || c_tail, ''))) / length(c_head || c_tail);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '166: expected the power branch of `monitored` exactly once in the live body, found % (body md5 %). Another migration changed that branch — rebase 166 onto the live body; do not force.', v_n, md5(v_old);
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_n := (length(v_def) - length(replace(v_def, c_head || c_tail, ''))) / length(c_head || c_tail);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '166: the power branch occurs % times in the full definition — refusing to patch', v_n;
    END IF;

    EXECUTE replace(v_def, c_head || c_tail, c_head || c_insert || c_tail);

    SELECT p.prosrc INTO v_new FROM pg_proc p WHERE p.oid = to_regprocedure(c_sig);
    IF v_new IS DISTINCT FROM replace(v_old, c_head || c_tail, c_head || c_insert || c_tail) THEN
      RAISE EXCEPTION '166: the new body is not the old body plus the 166 predicate — rolled back';
    END IF;
    RAISE NOTICE '166: predicate inserted — base body md5 % (%), new body md5 %',
      md5(v_old),
      CASE md5(v_old) WHEN 'd3de0425a39ec36875e76106a47f85f5' THEN 'mig 085'
                      WHEN '62b04fa280ef9a63e95ffea3b4618f04' THEN 'mig 164, PR-12 draft 5bce85e'
                      ELSE 'another revision — record it in the PR' END,
      md5(v_new);
  END IF;

  -- Comment: append the 166 note, keep whatever is already there.
  v_cmt := obj_description(v_oid, 'pg_proc');
  IF v_cmt IS NULL OR position('Mig 166' IN v_cmt) = 0 THEN
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', c_sig, concat_ws(' ', v_cmt, c_note));
  END IF;
END
$patch$;

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
--   predicate_once true · predicate_in_power_branch true ·
--   twin_linking true (164 applied first, as planned; false only if 166 went
--   on 085's body) · body '164 + 166' (or '085 + 166') · anon_exec false ·
--   authenticated_exec false · service_role_exec true ·
--   stale_3arg_overload false · change_log_rows 1 · roster_refinery 431 ·
--   roster_power 5046 · roster_total 5477 · rows_removed_pct 48.1 ·
--   refineries_dropped 0 · cems_rows 582 · cems_plants 401 · cems_min_mw 500 ·
--   cems_in_roster 582 · cems_bm_rows_on_power_plants_id 582
-- body reads 'other: <md5>' if PR-12 revised its function body after
-- 5bce85e — fine as long as the two predicate_* columns are true; paste it.
-- The roster columns apply the SAME predicate as §1 (a mirror, stated as
-- such); the behavioural test that calls the function itself is
-- supabase/tests/pr3_guards.sql (E1–E5, G1–G5). The region boxes mirror
-- FIRMS_REGIONS (apps/web/lib/firms/client.ts, origin/main 0b0d4b1, 8
-- boxes); if PR-11 has widened ru-ua east first, roster_power and
-- roster_total move by that box's operating sites.
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
  (SELECT (length(prosrc) - length(replace(prosrc, 'mig 166 (Reality Check PR-3)', '')))
          / length('mig 166 (Reality Check PR-3)') = 1 FROM fn)                   AS predicate_once,
  (SELECT position(E'       AND p.capacity_mw >= p_min_mw\n       -- mig 166 (Reality Check PR-3)' IN prosrc) > 0
     FROM fn)                                                                    AS predicate_in_power_branch,
  (SELECT prosrc LIKE '%firms_link_twins%' FROM fn)                              AS twin_linking,
  (SELECT CASE md5(prosrc) WHEN '970b5efc72895bbaeb6356d36fa3f896' THEN '085 + 166'
                           WHEN 'c4296bdc42502ae41f1e364476784099' THEN '164 + 166'
                           WHEN 'd3de0425a39ec36875e76106a47f85f5' THEN '085, 166 NOT applied'
                           WHEN '62b04fa280ef9a63e95ffea3b4618f04' THEN '164, 166 NOT applied'
                           ELSE 'other: ' || md5(prosrc) END FROM fn)            AS body,
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
