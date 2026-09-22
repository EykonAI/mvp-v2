-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 182 · Reality Check board follow-up: complexes named by their
--             refineries, sourced names for unnamed sites, the lead mask
--             closed, and the counts the board's copy needs, read from the
--             tick (Reality Check programme, after PR-6; §2.2, §3.3, §5, D-12)
--
-- WHY. The first published tick, 2026-W37 (run 32, hash c843ad1e…), was
-- checked line by line against the two one-pagers that cite it. The board
-- was wrong in four places the pages are right:
--
--   1 · IT NAMED A COMPLEX AFTER A PROCESS UNIT. reality_check_tick() (mig
--       171) took the first member name in collation order, so the refuted
--       Rotterdam complex RFC-N51-E004-3 read "amine regeneration sour water
--       strippers". Read from the OSM API on 2026-09-22, that name belongs to
--       way:895629447, a 1,870 m² polygon whose six vertices all lie inside
--       way:144928919, Gunvor Energy Rotterdam (1.36 km²). The pages call
--       the complex "Gunvor Energy Rotterdam + BP Raffinaderij Rotterdam".
--       The same rule named the Panipat complex "Gasoline": way:259662844
--       carried that name from OSM v3 (2021-10-05) to v6; v7 (2026-07-15)
--       restored "Panipat Refinery", after the registry's last ingest
--       (2026-04-30). The ordering also depended on the database collation,
--       so the same rows could be named differently on another server.
--
--   2 · FOUR REFUTED W37 COMPLEXES HAD NO NAME AT ALL. Each has only
--       landuse=industrial + industrial=refinery in its own OSM tags. One of
--       them is enclosed by a named OSM polygon; three are not (below).
--
--   3 · IT SHOWED A LEAD'S IDENTITY BELOW PRO. Mig 171 masked a lead's name
--       and location below Pro (§5, D-12) but still returned its cluster key
--       on the row, in the robustness block's list of verdicts that flip
--       (RFC-N46-W093-1 on W37), and echoed any key asked for in a withheld
--       drill-down. A cluster key is a coordinate cell: it identifies a site.
--
--   4 · ITS COPY TYPED WHAT THE TICK KNOWS. "141 observed complexes have no
--       thermal baseline" is false (63 of those 141 have baseline detection
--       days — the rule is a baseline detection RATE at or below 0.20), and
--       "every verdict on this board is a forward-testable claim" is false
--       (55 claims on 19 complexes; 276 of 295 verdicts carry none). The
--       accessor now returns both counts, so the board renders them.
--
-- THE NAMING RULE (general, deterministic, sourced — never an invented
-- string). A complex is named by the distinct names of its members in
-- facility-id order, compared byte by byte (COLLATE "C", so no server
-- collation can reorder them), at most two and then "+ N more". That is the
-- order the tick issuer already uses for the hashed claim statements
-- (reality_check_tick_inputs orders member names by facility_id), and so the
-- order the one-pagers print: "Gunvor Energy Rotterdam + BP Raffinaderij
-- Rotterdam", "Raffineria ISAB sito nord + Sonatrach Raffineria Italiana".
-- The board, the ledger and the pages name a complex one way. A member's name
-- is its sourced display_name when one is recorded, else its registry name.
-- A member recorded as PART OF another member of the same complex (its OSM
-- polygon lies inside that member's) is not used for the complex's name
-- while some other member has one. A complex with no name at all is shown by
-- its frozen centroid, "Unnamed site (29.745 N, 95.001 W)" — the form the
-- one-pagers print. Every member's name, parts included, stays in the Pro
-- drill-down.
--
-- WHY NOT RE-TYPE THE PROCESS UNIT (route (b), measured read-only on
-- 2026-09-22 and rejected). way:895629447 is part of a crude-oil refinery,
-- and site_type says what a site IS (mig 168 kept "parts of refineries" as
-- 'refinery' on purpose). Re-typing it would make rebuild_refinery_complexes
-- drop it from RFC-N51-E004-3 (the key survives — Gunvor and BP still share
-- it), would move /start's watched figure 353 → 352, and would CHANGE THE
-- NEXT TICK'S MEASUREMENT: on W37's own windows the unit contributes 15 of
-- the complex's clear facility-nights at a median 48.81 against Gunvor's
-- 33.76, and the pooled baseline median falls 47.81 → 39.64 (10 → 9 nights)
-- without it — the window 37.89 → 36.71. It adds no heat day of its own (23
-- detection days at each of the three members). A name is a label; that is a
-- method change, and it is not made here.
--
-- WHERE THE NAMES COME FROM (OSM API and Overpass, read-only, 2026-09-22):
--   way:614516782, :783, :785 (-6.767, 111.956, Tuban, East Java) — every
--     vertex of each lies inside way:604190258, landuse=industrial,
--     industrial=oil, name "Transpacific Petrochemical Indotama" (v7,
--     2025-11-23). Named from that polygon. NOTE FOR THE FOUNDER: the
--     enclosing object names a PETROCHEMICAL works (TPPI's aromatics complex
--     with a condensate splitter). Whether it is a crude-oil refinery is a
--     typing decision that changes future ticks; it is reported, not made.
--   way:259662844 (Panipat) — its own name tag, "Panipat Refinery", v7.
--   STAYS COORDINATES — no citable name exists:
--     way:1380474666 (29.745 N, 95.001 W, Baytown TX): a 1,109 m² building
--       tagged industrial=refinery inside an UNNAMED 12.5 km² industrial
--       polygon (way:41020432); nothing encloses it with a name. EIA-820 is
--       not loaded in this database (checked), so the EIA route is closed.
--     way:705312467 (35.065 N, 106.652 W, Albuquerque NM): a 12,359 m²
--       polygon enclosed by nothing but the Barelas neighbourhood and the
--       city; the nearest named features within 800 m are a Mid Rio Grande
--       Conservancy District office (209 m), a community centre (309 m) and
--       the National Hispanic Cultural Center (517 m).
--       REPORTED, NOT RE-TYPED: nothing here looks like a crude-oil refinery.
--     way:944039666 (30.647 N, 114.454 E, Qingshan, Wuhan): an 84,286 m²
--       polygon with no enclosing named polygon; it sits among WISCO steel
--       works (the sinter plant's centre 887 m away, the coking plant's
--       1.66 km) and 1.85 km from the centre of the Sinopec Wuhan branch's
--       polygon, which does not enclose it. REPORTED, NOT RE-TYPED.
--
-- NOTHING FROZEN IS TOUCHED. No row of reality_check_runs,
-- reality_check_site_verdicts or reality_check_issues is written; the
-- digest function is not replaced. Site names are outside the content hash
-- (mig 171: the hash covers the run row, the verdict rows and the frozen
-- claims block — names are joined in on read), so W37 still verifies; the
-- guard proves it by renaming a W37 member inside a rolled-back
-- subtransaction and re-reading the hash.
--
-- NOT HERE. No capacity, no mean, no parameter or threshold change, no
-- change to any claim statement (predictions_register is hash-bound: the
-- four public lead statements that name Donges and Superior are reported to
-- the founder, not edited). No table is created, so the SQL Editor's
-- appended ENABLE ROW LEVEL SECURITY line cannot fire.
--
-- LOCKS. ALTER TABLE refineries takes ACCESS EXCLUSIVE on the 650-row
-- registry until COMMIT (well under a second); the three UPDATEs lock five
-- registry rows. Do not paste within a few minutes of the daily tick
-- (~10:22 UTC), which reads the registry.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, constraints guarded by name, every
-- UPDATE guarded by the value read on 2026-09-22 and IS NULL on its target,
-- CREATE OR REPLACE, the change-log row guarded. No temp tables, no session
-- state. Apply MANUALLY in the Supabase SQL Editor, the whole file, after
-- 171, BEFORE merge. The VERIFY is the file's last statement: one SELECT,
-- every row ok = true.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1 · Two sourced facts the OSM ingest can never overwrite ──────────
-- The ingest (app/api/cron/ingest-osm-refineries) upserts ON CONFLICT (id)
-- DO UPDATE over the columns it sends and never sends these, so a re-ingest
-- leaves them alone — the pattern of site_type (mig 168). Each fact carries
-- its source beside it, and a CHECK refuses one without the other.
ALTER TABLE public.refineries ADD COLUMN IF NOT EXISTS display_name        text;
ALTER TABLE public.refineries ADD COLUMN IF NOT EXISTS display_name_source text;
ALTER TABLE public.refineries ADD COLUMN IF NOT EXISTS part_of_id          text;
ALTER TABLE public.refineries ADD COLUMN IF NOT EXISTS part_of_source      text;

COMMENT ON COLUMN public.refineries.display_name IS
  'Mig 182. A name for the site recorded with its source, for a site whose registry name is missing or stale. Shown in place of refinery_name wherever a site is named (reality_check_tick). Never written by the OSM ingest; never set without display_name_source.';
COMMENT ON COLUMN public.refineries.display_name_source IS
  'Mig 182. Where display_name was read: must begin with the object it came from ("OSM way:<id> …" or "EIA-820 …"), then what was read and when.';
COMMENT ON COLUMN public.refineries.part_of_id IS
  'Mig 182. This site is a part of another registry site — its OSM polygon lies inside that site''s. A part is still watched and still measured (its site_type is unchanged); it is only not used to NAME its complex while another member has a name. Never written by the OSM ingest.';
COMMENT ON COLUMN public.refineries.part_of_source IS
  'Mig 182. The evidence for part_of_id: must begin with "OSM <type>:<id>", then what was measured and when.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.refineries'::regclass
                    AND conname  = 'refineries_display_name_sourced') THEN
    ALTER TABLE public.refineries ADD CONSTRAINT refineries_display_name_sourced
      CHECK ((display_name IS NULL) = (display_name_source IS NULL)
             AND (display_name IS NULL OR btrim(display_name) <> '')
             AND (display_name_source IS NULL
                  OR display_name_source ~ '^(OSM (node|way|relation):[0-9]+|EIA-820) '));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.refineries'::regclass
                    AND conname  = 'refineries_part_of_sourced') THEN
    ALTER TABLE public.refineries ADD CONSTRAINT refineries_part_of_sourced
      CHECK ((part_of_id IS NULL) = (part_of_source IS NULL)
             AND (part_of_id IS NULL OR part_of_id <> id)
             AND (part_of_source IS NULL
                  OR part_of_source ~ '^OSM (node|way|relation):[0-9]+ '));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.refineries'::regclass
                    AND conname  = 'refineries_part_of_fkey') THEN
    ALTER TABLE public.refineries ADD CONSTRAINT refineries_part_of_fkey
      FOREIGN KEY (part_of_id) REFERENCES public.refineries (id);
  END IF;
END $$;

-- ─── 2 · The facts, each guarded by what was read on 2026-09-22 ────────
-- A row moves only if it still carries the registry value read that day and
-- its target column is still empty: a later decision is never overwritten,
-- and a re-run changes nothing.

-- 2a · way:895629447 is a part of Gunvor Energy Rotterdam
UPDATE public.refineries
   SET part_of_id     = 'way:144928919',
       part_of_source = 'OSM way:895629447 — a 1,870 m² polygon (industrial=refinery, name "amine regeneration sour water strippers") whose 6 vertices all lie inside way:144928919, Gunvor Energy Rotterdam (1.36 km²). OSM API, read 2026-09-22.'
 WHERE id = 'way:895629447'
   AND part_of_id IS NULL
   AND refinery_name IS NOT DISTINCT FROM 'amine regeneration sour water strippers'
   AND EXISTS (SELECT 1 FROM public.refineries p
                WHERE p.id = 'way:144928919'
                  AND p.refinery_name IS NOT DISTINCT FROM 'Gunvor Energy Rotterdam');

-- 2b · the three unnamed Tuban polygons are inside a named OSM polygon
UPDATE public.refineries
   SET display_name        = 'Transpacific Petrochemical Indotama',
       display_name_source = 'OSM way:604190258 — landuse=industrial, industrial=oil, name "Transpacific Petrochemical Indotama" (v7, 2025-11-23) encloses every vertex of this way. OSM API, read 2026-09-22.'
 WHERE id IN ('way:614516782', 'way:614516783', 'way:614516785')
   AND display_name IS NULL
   AND refinery_name IS NULL;

-- 2c · way:259662844's own OSM name, which the registry has not re-read
UPDATE public.refineries
   SET display_name        = 'Panipat Refinery',
       display_name_source = 'OSM way:259662844 — its own name tag, "Panipat Refinery" since v7 (2026-07-15); v3–v6 (2021-10-05 to 2026-07-15) read "Gasoline", which the registry still holds from its 2026-04-30 ingest. OSM API history, read 2026-09-22.'
 WHERE id = 'way:259662844'
   AND display_name IS NULL
   AND refinery_name IS NOT DISTINCT FROM 'Gasoline';

-- ─── 3 · The ONE read accessor, re-issued ──────────────────────────────
-- Same signature, same return, same field mask as mig 171, with four
-- changes: the naming rule above; a lead's identity (name, cluster key,
-- location, members) withheld below Pro EVERYWHERE in the payload, the
-- robustness list and the drill-down echo included; no US state on any row
-- (the one-pagers print none, and §3.3's Location is ISO country, city where
-- the registry holds one, and coordinates); and two counts the board's copy
-- renders instead of typing — the heat-not-observable split, and the claims
-- this tick put on the register. It still classifies nothing, and the
-- content hash is recomputed exactly as before.
CREATE OR REPLACE FUNCTION public.reality_check_tick(
  p_tier        text DEFAULT 'pro',
  p_tick        text DEFAULT NULL,
  p_cluster_key text DEFAULT NULL,
  p_asset       text DEFAULT 'refinery'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_tier     text := CASE lower(coalesce(p_tier, '')) WHEN 'pro' THEN 'pro'
                                                      WHEN 'member' THEN 'member'
                                                      ELSE 'public' END;
  i          public.reality_check_issues%ROWTYPE;
  r          public.reality_check_runs%ROWTYPE;
  v_out      jsonb;
  v_rows     jsonb;
  v_arch     jsonb;
  v_sup_by   jsonb;
  v_sup      text;
  v_hash     text;
  v_live     jsonb;
  v_runs     integer;
  v_done     integer;
  v_robust   jsonb;
  v_hno      integer;
  v_hno_rows integer;
  v_hno_some integer;
  v_hno_none integer;
  v_reg_n    integer;
  v_reg_cx   integer;
BEGIN
  IF p_tick IS NULL THEN
    -- the current tick: the newest published one that nothing supersedes
    SELECT * INTO i
      FROM public.reality_check_issues x
     WHERE x.asset_class = p_asset
       AND NOT EXISTS (SELECT 1 FROM public.reality_check_issues y
                        WHERE y.supersedes_run_id = x.run_id)
     ORDER BY x.data_clock_night DESC, x.revision DESC
     LIMIT 1;
  ELSE
    SELECT * INTO i FROM public.reality_check_issues x
     WHERE x.asset_class = p_asset AND x.tick_slug = p_tick;
  END IF;

  -- ── the honest empty state ──────────────────────────────────────────
  IF i.run_id IS NULL THEN
    SELECT count(*), count(*) FILTER (WHERE status = 'complete')
      INTO v_runs, v_done
      FROM public.reality_check_runs WHERE asset_class = p_asset;
    RETURN jsonb_build_object(
      'published', false,
      'asset_class', p_asset,
      'tier', v_tier,
      'requested_tick', p_tick,
      'empty_reason', CASE
        WHEN p_tick IS NOT NULL THEN format('No tick %L has been published for %s.', p_tick, p_asset)
        WHEN v_done > 0 THEN 'The tick has run but nothing is published yet — the next cron run publishes it.'
        ELSE 'No tick has been published yet. The first refinery tick publishes when the weekly run finds a data clock to anchor its window to; until then this board shows nothing, because showing a number here would be an invention.'
        END,
      'runs_total', coalesce(v_runs, 0),
      'runs_complete', coalesce(v_done, 0),
      'as_of', now());
  END IF;

  SELECT * INTO r FROM public.reality_check_runs WHERE id = i.run_id;

  -- ── supersession, derived — never stored on a frozen row ────────────
  SELECT jsonb_build_object('tick', y.tick_slug, 'published_at', y.published_at)
    INTO v_sup_by
    FROM public.reality_check_issues y WHERE y.supersedes_run_id = i.run_id;
  SELECT x.tick_slug INTO v_sup
    FROM public.reality_check_issues x WHERE x.run_id = i.supersedes_run_id;

  -- ── integrity: recompute the hash over the frozen rows (unchanged) ──
  v_hash := public.reality_check_issue_digest(i.run_id, i.claims, i.claims_issued, i.digest_keys);

  -- ── the live monitor, beside the frozen claims line (D-7) ───────────
  BEGIN
    v_live := public.refinery_rc_walkforward();
  EXCEPTION WHEN OTHERS THEN
    v_live := jsonb_build_object('error', SQLERRM);
  END;

  -- ── what "heat not observable" is made of, counted from the tick ────
  -- Observed complexes whose baseline heat-detection RATE is at or below
  -- the floor. Many have detection days — too few to fall from, not none.
  SELECT count(*),
         coalesce(sum(member_count), 0),
         count(*) FILTER (WHERE baseline_heat_days > 0),
         count(*) FILTER (WHERE baseline_heat_days = 0)
    INTO v_hno, v_hno_rows, v_hno_some, v_hno_none
    FROM public.reality_check_site_verdicts
   WHERE run_id = i.run_id
     AND coverage_state = 'OBSERVED'
     AND heat_state = 'HEAT_NOT_OBSERVABLE';

  -- ── the claims this tick put on the register ────────────────────────
  -- Read, not assumed: which complexes carry a claim is whatever the issuer
  -- wrote (context.tick_run_id), so the board never states a rule the
  -- register does not show. Complexes only — no key, no name.
  SELECT count(*), count(DISTINCT p.context->>'cluster_key')
    INTO v_reg_n, v_reg_cx
    FROM public.predictions_register p
   WHERE p.source = 'refinery-rc'
     AND p.context->>'tick_run_id' = i.run_id::text;

  -- ── the robustness block, with a lead's key withheld below Pro ──────
  SELECT i.robustness || jsonb_build_object('not_robust', coalesce((
           SELECT jsonb_agg(CASE WHEN e->>'verdict' = 'LEAD' AND v_tier <> 'pro'
                                 THEN jsonb_build_object('cluster_key', NULL,
                                                         'verdict', e->'verdict',
                                                         'robustness_verdict', e->'robustness_verdict',
                                                         'name_masked', true)
                                 ELSE e || jsonb_build_object('name_masked', false) END
                            ORDER BY o)
             FROM jsonb_array_elements(i.robustness->'not_robust') WITH ORDINALITY AS a(e, o)),
           '[]'::jsonb))
    INTO v_robust;

  -- ── the board rows, masked (§5) ─────────────────────────────────────
  WITH v AS (
    SELECT * FROM public.reality_check_site_verdicts WHERE run_id = i.run_id
  ), mem AS (
    -- every member of every complex on this tick, with the name it is shown by
    SELECT v.cluster_key, rf.id,
           coalesce(rf.display_name, rf.refinery_name)                              AS nm,
           CASE WHEN rf.display_name IS NOT NULL THEN rf.display_name_source END      AS nm_source,
           (rf.part_of_id IS NOT NULL AND rf.part_of_id = ANY (v.members))            AS is_part,
           rf.part_of_id, rf.iso_country, rf.country, rf.city
      FROM v JOIN public.refineries rf ON rf.id = ANY (v.members)
  ), named AS (
    SELECT m.*,
           bool_or(m.nm IS NOT NULL AND NOT m.is_part) OVER (PARTITION BY m.cluster_key) AS has_named_whole
      FROM mem m
  ), title AS (
    -- one entry per distinct name, in the facility-id order of its first
    -- member, byte by byte (COLLATE "C": no server collation reorders it)
    SELECT d.cluster_key,
           array_agg(d.nm ORDER BY d.first_id, d.nm COLLATE "C")                    AS names,
           array_agg(d.src ORDER BY d.first_id, d.nm COLLATE "C")
             FILTER (WHERE d.src IS NOT NULL)                                         AS sources
      FROM (SELECT n.cluster_key, n.nm, min(n.id COLLATE "C") AS first_id, min(n.nm_source) AS src
              FROM named n
             WHERE n.nm IS NOT NULL AND (NOT n.is_part OR NOT n.has_named_whole)
             GROUP BY n.cluster_key, n.nm) d
     GROUP BY d.cluster_key
  ), site AS (
    SELECT m.cluster_key,
           array_agg(coalesce(m.nm, '(unnamed OSM site ' || m.id || ')')
                     || CASE WHEN m.is_part
                             THEN ' (part of ' || coalesce(p.display_name, p.refinery_name, m.part_of_id) || ')'
                             ELSE '' END
                     ORDER BY m.id COLLATE "C")                                              AS member_names,
           (array_agg(m.iso_country ORDER BY (m.iso_country IS NULL), m.id COLLATE "C"))[1]  AS iso_country,
           (array_agg(m.country     ORDER BY (m.country     IS NULL), m.id COLLATE "C"))[1]  AS country,
           (array_agg(m.city        ORDER BY (m.city        IS NULL), m.id COLLATE "C"))[1]  AS city,
           count(DISTINCT m.iso_country)::int                                                AS iso_countries
      FROM mem m
      LEFT JOIN public.refineries p ON p.id = m.part_of_id
     GROUP BY m.cluster_key
  )
  SELECT jsonb_agg(payload ORDER BY ord, key) INTO v_rows
    FROM (
      SELECT
        -- the refutation cell is the hero: refuted rows sort first, the lead
        -- never leads the board (§3.3)
        CASE v.verdict WHEN 'REFUTED' THEN 0 WHEN 'LEAD' THEN 1 WHEN 'LIGHT_DOWN_ONLY' THEN 2
                       WHEN 'STEADY' THEN 3 ELSE 4 END AS ord,
        v.cluster_key AS key,
        CASE WHEN v.verdict = 'LEAD' AND v_tier <> 'pro' THEN
          -- §5 "lead complexes: names — count only". What identifies the
          -- site is withheld: the name, the cluster key (a coordinate cell),
          -- the location and the members. The row stays, so the board's
          -- counts still add up.
          jsonb_build_object(
            'row_key', 'withheld-lead-' || row_number() OVER (
                         PARTITION BY (v.verdict = 'LEAD') ORDER BY v.cluster_key),
            'cluster_key', NULL,
            'site_name', NULL,
            'name_masked', true,
            'name_sources', NULL,
            'member_count', v.member_count,
            'member_names', NULL,
            'members', NULL,
            'location', NULL)
        ELSE
          jsonb_build_object(
            'row_key', v.cluster_key,
            'cluster_key', v.cluster_key,
            'site_name', CASE
               WHEN t.names IS NULL OR cardinality(t.names) = 0 THEN
                 'Unnamed site (' || round(abs(c.centroid_lat)::numeric, 3)
                   || CASE WHEN c.centroid_lat < 0 THEN ' S, ' ELSE ' N, ' END
                   || round(abs(c.centroid_lon)::numeric, 3)
                   || CASE WHEN c.centroid_lon < 0 THEN ' W)' ELSE ' E)' END
               WHEN cardinality(t.names) <= 2 THEN array_to_string(t.names, ' + ')
               ELSE t.names[1] || ' + ' || t.names[2] || ' + '
                    || (cardinality(t.names) - 2) || ' more'
               END,
            'name_masked', false,
            'name_sources', CASE WHEN t.sources IS NULL OR cardinality(t.sources) = 0 THEN NULL
                                 ELSE to_jsonb(t.sources) END,
            'member_count', v.member_count,
            'member_names', CASE WHEN v_tier = 'pro' THEN to_jsonb(s.member_names) ELSE NULL END,
            'members', CASE WHEN v_tier = 'pro' THEN to_jsonb(v.members) ELSE NULL END,
            'location', jsonb_build_object(
                'iso_country', s.iso_country,
                'country', s.country,
                'city', s.city,
                'multi_country', s.iso_countries > 1,
                'latitude', round(c.centroid_lat::numeric, 4),
                'longitude', round(c.centroid_lon::numeric, 4),
                'note', 'ISO country and city are read from the refinery registry on each request, so a re-geocoded site changes its label here even on a frozen tick; the coordinates are the complex centroid, written once at mint and never updated. No US state is printed, and no other place name is invented. No measurement, threshold or verdict is outside the content hash.'))
        END
        || jsonb_build_object(
          'verdict', v.verdict,
          'coverage_state', v.coverage_state,
          'heat_state', v.heat_state,
          'light', jsonb_build_object(
              'baseline_nights', v.baseline_nights,
              'window_nights', v.window_nights,
              'baseline_median', v.baseline_median,
              'window_median', v.window_median,
              'baseline_min', v.baseline_min,
              'baseline_max', v.baseline_max,
              'window_min', v.window_min,
              'window_max', v.window_max,
              'ratio', v.light_ratio,
              'distributions_overlap', v.distributions_overlap),
          'heat', jsonb_build_object(
              'baseline_firms_days', v.baseline_firms_days,
              'baseline_heat_days', v.baseline_heat_days,
              'window_firms_days', v.window_firms_days,
              'window_heat_days', v.window_heat_days,
              'baseline_rate', v.baseline_heat_rate,
              'window_rate', v.window_heat_rate),
          'robustness', jsonb_build_object(
              'verdict', v.robustness_verdict,
              'robust_to_retrieval', v.robust_to_retrieval,
              'baseline_nights', v.r3_baseline_nights,
              'window_nights', v.r3_window_nights,
              'baseline_median', v.r3_baseline_median,
              'window_median', v.r3_window_median,
              'ratio', v.r3_light_ratio),
          'stability', jsonb_build_object('tested', v.ks_tested, 'd', v.ks_d, 'p', v.ks_p),
          -- D-11 / §6: a cell, a reason, and never a figure. CAP-3 is not
          -- built, so every row reads the unknown state.
          'capacity', jsonb_build_object(
              'established', false,
              'label', 'Capacity not established',
              'reason', 'No sourced capacity record exists for this site. The provenance chain (CAP-1 to CAP-4) is not built, so this board states what a site is, never what it can process. A figure appears here only with its source, edition and match grade — never as a dash, a zero, an estimate or a volume.')
        ) AS payload
      FROM v
      JOIN public.refinery_complexes c ON c.cluster_key = v.cluster_key
      LEFT JOIN site  s ON s.cluster_key = v.cluster_key
      LEFT JOIN title t ON t.cluster_key = v.cluster_key
    ) q;

  -- ── the archive (§5: pro gets every tick, others the current one) ────
  SELECT jsonb_agg(jsonb_build_object(
           'tick', x.tick_slug, 'revision', x.revision,
           'data_clock_night', x.data_clock_night,
           'window_start', x.window_start, 'window_end', x.window_end,
           'published_at', x.published_at,
           'refuted', x.refuted_complexes, 'lead', x.lead_complexes,
           'current', NOT EXISTS (SELECT 1 FROM public.reality_check_issues y
                                   WHERE y.supersedes_run_id = x.run_id))
           ORDER BY x.data_clock_night DESC, x.revision DESC)
    INTO v_arch
    FROM public.reality_check_issues x
   WHERE x.asset_class = p_asset
     AND (v_tier = 'pro' OR x.run_id = i.run_id);

  v_out := jsonb_build_object(
    'published', true,
    'tier', v_tier,
    'asset_class', i.asset_class,
    'tick', i.tick_slug,
    'revision', i.revision,
    'published_at', i.published_at,
    'data_clock_night', i.data_clock_night,
    'windows', jsonb_build_object(
      'baseline_start', i.baseline_start, 'baseline_end', i.baseline_end,
      'window_start', i.window_start, 'window_end', i.window_end,
      'baseline_nights', (i.baseline_end - i.baseline_start) + 1,
      'window_nights', (i.window_end - i.window_start) + 1,
      'rule', 'Both windows are inclusive of both endpoints and stored as explicit dates: window_end is the data-clock night, the window is the 15 nights ending there, the baseline the 31 nights before it.'),
    'parameters', i.parameters,
    'funnel', jsonb_build_object(
      'counted_by', 'complex',
      'watched',         jsonb_build_object('complexes', i.watched_complexes,         'rows', i.watched_rows),
      'observed',        jsonb_build_object('complexes', i.observed_complexes,        'rows', i.observed_rows),
      'heat_observable', jsonb_build_object('complexes', i.heat_observable_complexes, 'rows', i.heat_observable_rows),
      'thermally_dark',  jsonb_build_object('complexes', i.thermally_dark_complexes,  'rows', i.thermally_dark_rows),
      'refuted',         jsonb_build_object('complexes', i.refuted_complexes,         'rows', i.refuted_rows),
      'lead',            jsonb_build_object('complexes', i.lead_complexes,            'rows', i.lead_rows),
      'withheld',        jsonb_build_object('complexes', i.withheld_complexes,        'rows', i.withheld_rows)),
    'heat_not_observable', jsonb_build_object(
      'complexes', v_hno,
      'rows', v_hno_rows,
      'with_baseline_detection', v_hno_some,
      'without_baseline_detection', v_hno_none,
      'floor', i.parameters->'heat_observable_floor',
      'rule', 'Observed complexes whose baseline heat-detection rate (days with a FIRMS detection over FIRMS days) is at or below the floor: too little heat to fall from. Many had detection days; the rate, not the count, puts them here. Reported as heat not observable, never as heat steady.'),
    'counts_by_verdict', i.counts_by_verdict,
    'robustness', v_robust,
    'claims', jsonb_build_object(
      'issued_on_this_tick', i.claims_issued,
      'at_publication', i.claims,
      'live', v_live,
      'on_register', jsonb_build_object(
        'claims', v_reg_n,
        'complexes', v_reg_cx,
        'verdicts_without_claims', i.watched_complexes - v_reg_cx,
        'rule', 'Counted from the calibration ledger''s register (source refinery-rc, issued by this tick). Claims issue on the thermally dark complexes, on alternate ticks; every other verdict on the tick carries none.')),
    'coverage', jsonb_build_object(
      'bm_nights_used', to_jsonb(r.bm_nights_used),
      'firms_days_used', to_jsonb(r.firms_days_used),
      'calendar_nights', (i.window_end - i.baseline_start) + 1,
      'note', 'A night absent from bm_nights_used was not usable in the census for this tick — thin, incomplete or not ingested. It is a night not looked at, never a dark night.'),
    'integrity', jsonb_build_object(
      'content_hash', i.content_hash,
      'recomputed', v_hash,
      'hash_matches', v_hash = i.content_hash,
      'frozen', true,
      'digest_keys', i.digest_keys,
      'covers', 'The run row, every verdict row and the claims block as published — every measurement, threshold, window and verdict on this board.',
      'not_covered', 'Site names (the registry name, or a display name recorded with its source), city and country are read from the refinery registry on each request, not frozen with the tick: if a site is renamed or re-geocoded in the registry, the label on a cited tick follows it. The complex centroid IS frozen — it is written once at mint and never updated. No measurement, threshold or verdict is outside the hash.'),
    'supersession', jsonb_build_object(
      'current', v_sup_by IS NULL,
      'superseded_by', v_sup_by,
      'supersedes', v_sup),
    'archive', coalesce(v_arch, '[]'::jsonb),
    'rows', coalesce(v_rows, '[]'::jsonb),
    'mask', jsonb_build_object(
      'tier', v_tier,
      'lead_names', CASE WHEN v_tier = 'pro' THEN 'visible' ELSE 'count only' END,
      'lead_identity', CASE WHEN v_tier = 'pro' THEN 'visible'
                            ELSE 'withheld — name, cluster key, location and members' END,
      'drilldown', CASE WHEN v_tier = 'pro' THEN 'available' ELSE 'pro only' END,
      'archive', CASE WHEN v_tier = 'pro' THEN 'all ticks' ELSE 'current tick only' END),
    'as_of', now());

  -- ── the drill-down: both sensor strips, pro only (§5) ────────────────
  IF p_cluster_key IS NOT NULL AND v_tier = 'pro' THEN
    v_out := v_out || jsonb_build_object('drilldown', (
      SELECT jsonb_build_object(
        'cluster_key', p_cluster_key,
        'nights', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
                   'night', d.night,
                   'phase', CASE WHEN d.night >= i.window_start THEN 'window' ELSE 'baseline' END,
                   -- the light strip. A night the census never made usable is
                   -- NIGHT_NOT_USABLE; a usable night with no row for this
                   -- complex is NOT_INGESTED; a clear night with no retrieval
                   -- is CLEAR_NO_RETRIEVAL. None of them is a zero (2.3).
                   'light_state', CASE
                      WHEN NOT (d.night = ANY (coalesce(r.bm_nights_used, ARRAY[]::date[]))) THEN 'NIGHT_NOT_USABLE'
                      WHEN l.cluster_key IS NULL THEN 'NOT_INGESTED'
                      ELSE l.coverage_state END,
                   'radiance_median', l.radiance_median,
                   'radiance_3x3_median', l.radiance_3x3_median,
                   'clear_members', l.clear_members,
                   'retrieval_members', l.retrieval_members,
                   'heat_state', CASE
                      WHEN NOT (d.night = ANY (coalesce(r.firms_days_used, ARRAY[]::date[]))) THEN 'DAY_NOT_USABLE'
                      WHEN h.cluster_key IS NULL THEN 'NOT_INGESTED'
                      WHEN h.heat_day THEN 'DETECTION'
                      ELSE 'NO_DETECTION' END,
                   'detecting_members', h.detecting_members)
                 ORDER BY d.night)
            FROM generate_series(i.baseline_start, i.window_end, interval '1 day') AS g(ts)
            CROSS JOIN LATERAL (SELECT g.ts::date AS night) d
            LEFT JOIN public.refinery_complex_light_nights l
                   ON l.cluster_key = p_cluster_key AND l.night = d.night
            LEFT JOIN public.refinery_complex_heat_days h
                   ON h.cluster_key = p_cluster_key AND h.day = d.night), '[]'::jsonb),
        'legend', jsonb_build_object(
          'NIGHT_NOT_USABLE', 'The census did not make this night usable for refineries — a night not looked at, drawn as a gap.',
          'NOT_INGESTED', 'The night is usable but this complex has no row: nothing was written for it. A gap, never a zero.',
          'NOT_CLEAR', 'Cloud. No member had a confident-clear look.',
          'CLEAR_NO_RETRIEVAL', 'Cloud-clear but no radiance retrieval — roughly 2,500 refinery-nights are like this. Clear is not the same as observed.',
          'OBSERVED', 'A confident-clear night carrying a retrieval: the only nights the statistic uses.',
          'DAY_NOT_USABLE', 'The census did not make this FIRMS day usable — not a day without heat.',
          'NO_DETECTION', 'A usable FIRMS day with no detection at any member. A hot pixel is not a fire; its absence is not an outage.',
          'DETECTION', 'At least one member had a FIRMS detection that day.')
      )));
  ELSIF p_cluster_key IS NOT NULL THEN
    -- Below Pro the key asked for is NOT echoed: echoing it only for keys
    -- that are not leads would turn this answer into a lead detector.
    v_out := v_out || jsonb_build_object('drilldown', jsonb_build_object(
      'cluster_key', NULL,
      'withheld', true,
      'reason', 'The night-by-night sensor strips are a Pro surface (build prompt 5, D-12).'));
  END IF;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.reality_check_tick(text, text, text, text) IS
  'Reality Check PR-6 (mig 171), re-issued by mig 182. THE read accessor: the board, the BRIEFS issue (PR-7) and query_reality_check (PR-8) all call this and nothing else (5.3). Returns the published tick — funnel terms by complex, the heat-not-observable split, parameters, windows, counts by verdict, the 3x3 robustness funnel, the claims line frozen at publication beside the live monitor and the claims this tick put on the register, the coverage strip, the content hash recomputed, the supersession links, the archive and the masked rows. Complexes are named by their members'' names in facility-id order, byte by byte — the order of the claim statements (a sourced display_name first; a recorded part of another member is not used while another member has a name), or by their frozen centroid. Below Pro a lead''s name, cluster key, location and members are withheld everywhere in the payload (5, D-12), and a withheld drill-down does not echo the key asked for. Classifies nothing. Service role only.';

REVOKE EXECUTE ON FUNCTION public.reality_check_tick(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reality_check_tick(text, text, text, text) TO service_role;

-- ─── 4 · The decision on the record ────────────────────────────────────
INSERT INTO public.ledger_change_log (at, pr, note)
SELECT now(), '#board-followup · mig 182',
       'Reality Check board follow-up (mig 182): no measurement, threshold, window, verdict or claim changed, and no frozen tick row was written — tick 2026-W37 keeps its content hash. The board names a complex by its members'' names in facility-id order, as the claim statements do (a sourced display name first; a site recorded as part of another member — its polygon inside that member''s — is not used for the name while another member has one), or by its frozen centroid when no member is named; two sourced facts were recorded (refineries.display_name / part_of_id, each with its source). Below Pro a lead''s name, cluster key, location and members are withheld everywhere in the accessor''s payload. The board''s counts of heat-not-observable complexes and of claim-bearing complexes are read from the tick and the register instead of being written into its copy.'
 WHERE NOT EXISTS (SELECT 1 FROM public.ledger_change_log WHERE note LIKE 'Reality Check board follow-up (mig 182)%');

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — ONE SELECT (the SQL Editor shows only the last statement's rows).
-- Every row must read ok = true. Expected values measured read-only on
-- production, 2026-09-22.
-- ═══════════════════════════════════════════════════════════════════════
WITH t AS (
  SELECT public.reality_check_tick('pro',    '2026-W37') AS pro,
         public.reality_check_tick('member', '2026-W37') AS mem,
         public.reality_check_tick('public', '2026-W37', 'RFC-N46-W093-1') AS pub
), lead AS (
  -- everything that identifies a W37 lead: its key, its members' ids, the
  -- names they are known by
  SELECT v.cluster_key AS k, rf.id AS fid,
         rf.refinery_name AS rname, rf.display_name AS dname
    FROM public.reality_check_site_verdicts v
    JOIN public.refineries rf ON rf.id = ANY (v.members)
   WHERE v.run_id = (SELECT run_id FROM public.reality_check_issues WHERE tick_slug = '2026-W37')
     AND v.verdict = 'LEAD'
), rowname AS (
  SELECT x->>'cluster_key' AS k, x->>'site_name' AS n
    FROM t, jsonb_array_elements(t.pro->'rows') x
), checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'refineries: display_name, display_name_source, part_of_id, part_of_source', '4',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'refineries'
             AND column_name IN ('display_name', 'display_name_source', 'part_of_id', 'part_of_source'))
  UNION ALL
  SELECT 2, 'the two sourcing CHECKs and the part-of foreign key', '3',
         (SELECT count(*)::text FROM pg_constraint
           WHERE conrelid = 'public.refineries'::regclass
             AND conname IN ('refineries_display_name_sourced', 'refineries_part_of_sourced', 'refineries_part_of_fkey'))
  UNION ALL
  SELECT 3, 'sourced display names recorded', 'way:259662844 · way:614516782 · way:614516783 · way:614516785',
         (SELECT string_agg(id, ' · ' ORDER BY id COLLATE "C") FROM public.refineries WHERE display_name IS NOT NULL)
  UNION ALL
  SELECT 4, 'part-of recorded', 'way:895629447 → way:144928919',
         (SELECT string_agg(id || ' → ' || part_of_id, ' · ' ORDER BY id COLLATE "C") FROM public.refineries WHERE part_of_id IS NOT NULL)
  UNION ALL
  SELECT 5, 'accessor: anon · authenticated · service_role may execute', 'false · false · true',
         has_function_privilege('anon', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE')::text
         || ' · ' || has_function_privilege('authenticated', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE')::text
         || ' · ' || has_function_privilege('service_role', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE')::text
  UNION ALL
  SELECT 6, 'tick 2026-W37 still verifies: stored hash · recomputed matches', 'c843ad1e162d · true',
         (SELECT left(pro#>>'{integrity,content_hash}', 12) || ' · ' || (pro#>>'{integrity,hash_matches}') FROM t)
  UNION ALL
  SELECT 7, 'W37 Rotterdam complex is named by its two refineries', 'Gunvor Energy Rotterdam + BP Raffinaderij Rotterdam',
         (SELECT n FROM rowname WHERE k = 'RFC-N51-E004-3')
  UNION ALL
  SELECT 8, 'W37 Tuban complex carries its sourced name', 'Transpacific Petrochemical Indotama',
         (SELECT n FROM rowname WHERE k = 'RFC-S07-E111-1')
  UNION ALL
  SELECT 9, 'W37 sites with no citable name stay coordinates (TX · NM · CN)',
         'Unnamed site (29.745 N, 95.001 W) · Unnamed site (35.065 N, 106.652 W) · Unnamed site (30.647 N, 114.454 E)',
         (SELECT (SELECT n FROM rowname WHERE k = 'RFC-N29-W096-3') || ' · '
              || (SELECT n FROM rowname WHERE k = 'RFC-N35-W107-1') || ' · '
              || (SELECT n FROM rowname WHERE k = 'RFC-N30-E114-1'))
  UNION ALL
  SELECT 10, 'below Pro, no W37 lead key, member id or name appears anywhere (member and public payloads)', '0',
         (SELECT count(*)::text FROM lead, t
           WHERE strpos(t.mem::text, lead.k) > 0 OR strpos(t.pub::text, lead.k) > 0
              OR strpos(t.mem::text, '"' || lead.fid || '"') > 0 OR strpos(t.pub::text, '"' || lead.fid || '"') > 0
              OR (lead.rname IS NOT NULL AND (strpos(t.mem::text, lead.rname) > 0 OR strpos(t.pub::text, lead.rname) > 0))
              OR (lead.dname IS NOT NULL AND (strpos(t.mem::text, lead.dname) > 0 OR strpos(t.pub::text, lead.dname) > 0)))
  UNION ALL
  SELECT 11, 'W37 heat not observable: complexes · with baseline detection days · without', '141 · 63 · 78',
         (SELECT (pro#>>'{heat_not_observable,complexes}') || ' · ' || (pro#>>'{heat_not_observable,with_baseline_detection}')
                 || ' · ' || (pro#>>'{heat_not_observable,without_baseline_detection}') FROM t)
  UNION ALL
  SELECT 12, 'W37 claims on the register: claims · complexes · verdicts without a claim', '55 · 19 · 276',
         (SELECT (pro#>>'{claims,on_register,claims}') || ' · ' || (pro#>>'{claims,on_register,complexes}')
                 || ' · ' || (pro#>>'{claims,on_register,verdicts_without_claims}') FROM t)
  UNION ALL
  SELECT 13, 'no row prints a US state', '0',
         (SELECT count(*)::text FROM t, jsonb_array_elements(t.pro->'rows') x WHERE x->'location' ? 'us_state')
  UNION ALL
  SELECT 14, 'the frozen W37 rows are all still there: verdicts · issue', '295 · 1',
         (SELECT count(*)::text FROM public.reality_check_site_verdicts WHERE run_id = 32)
         || ' · ' || (SELECT count(*)::text FROM public.reality_check_issues WHERE run_id = 32)
  UNION ALL
  SELECT 15, 'change-log row', '1',
         (SELECT count(*)::text FROM public.ledger_change_log WHERE note LIKE 'Reality Check board follow-up (mig 182)%')
)
SELECT ord, check_name, expected, actual, actual IS NOT DISTINCT FROM expected AS ok
  FROM checks
 ORDER BY ord;
