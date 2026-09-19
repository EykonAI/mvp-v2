-- 165 · Stored convergence syntheses stop calling co-occurrence "corroboration"
--       (Reality Check programme rev H, PR-10 — public-surface truth pass).
--
-- PURPOSE
-- -------
-- A data fix, guarded and idempotent. A convergence is anomalies from two or
-- more domains inside one 10°×10° cell (~1,100 km) within 72 h. Nothing in
-- that ties a thermal hot pixel to a reported strike, yet until PR-10 the
-- compute-convergences prompt told the model that for "sensor-confirmed" cells
-- it "may state the signals corroborate" — and it did. Those sentences are
-- served publicly on /c/[id], the page promotional posts linked to:
--   "Russian strikes on Ukrainian power infrastructure around Kyiv are
--    corroborated by FIRMS thermal ignitions at the Kyiv CHP plant ..."
-- PR-10's code change (lib/intel/convergenceSynthesis.ts) stops new ones: a
-- new prompt, plus a gate that discards any synthesis using corroboration or
-- confirmation vocabulary. This migration fixes the rows already stored.
--
-- MEASURED (read-only via supabase-ro, 2026-09-18)
-- ------------------------------------------------
--   convergence_events                                        724 rows
--   synthesis ~* 'corroborat'                                 269  (709 rows / 269 at the rev H audit)
--     of which single-source ("... await physical corroboration" — honest)  1
--     of which sensor-confirmed                               268
--   sensor-confirmed, no 'corroborat' but a word starting 'confirm'
--     ("Sensor-confirmed strikes on Iranian refinery infrastructure ...")    18
--   => AFFECTED ROWS (the rule below)                         286
--        naming strikes/attacks/drones/missiles                56
--        carrying a sensor-firms class                        266
--        created 2026-07-22 11:00 → 2026-09-06 05:01 UTC; none since (every
--        synthesis after 09-06 is the deterministic fallback sentence)
--   every affected row has source_classes, bounding_box and location
--   convergence_events carries no triggers; RLS policy convergence_public_read
--
-- THE REWRITE RULE (exact)
-- ------------------------
--   Target:  corroboration_level = 'sensor-confirmed'
--            AND synthesis ~* '(corroborat|\mconfirm)'
--            AND no revision row yet for (id, '165_cell_cooccurrence')
--   New synthesis, built only from stored fields:
--     <Classes> signals co-occurred within a <N>°×<N>° cell around <location>
--     inside 72 hours. Sharing a cell is co-occurrence only: a thermal hot
--     pixel is not a strike, an attack or an outage.
--   where <Classes> is source_classes in stored order, labelled
--     media → media-reported · sensor-firms → FIRMS thermal ·
--     sensor-viirs-dnb → night-lights · sensor-ais → AIS · other:X → X,
--   joined "A", "A and B", "A, B and C", first letter capitalised;
--   <N> = round(bounding_box.lat_max − bounding_box.lat_min) (10 on all 286);
--   <location> = the stored location string, e.g. "(55.0, 35.0)".
--   Example: "Media-reported and FIRMS thermal signals co-occurred within a
--   10°×10° cell around (55.0, 35.0) inside 72 hours. Sharing a cell is
--   co-occurrence only: a thermal hot pixel is not a strike, an attack or an
--   outage."
--   The new sentence contains neither 'corroborat' nor a word starting
--   'confirm', so a rewritten row can never be a target again.
--
-- WHY A REVISION TABLE
-- --------------------
-- Nothing is lost. Every original sentence is kept, verbatim, in
-- convergence_synthesis_revisions (RLS on, no policy, anon/authenticated
-- revoked — service role and the SQL Editor only), one row per
-- (convergence_id, rule) by UNIQUE constraint. The UPDATE only touches a row
-- whose synthesis still equals the recorded original, so:
--   · re-running this file changes nothing that was already fixed;
--   · a row written by the OLD code between applying this file and the PR's
--     deploy is caught by re-running it (or: select * from
--     public.rewrite_convergence_cooccurrence_165();).
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not touch joint_p_value, corroboration_level or source_classes, the
-- 26 legacy rows with no corroboration_level, or any single-source row. It
-- does not delete anything. No temp tables, no session state (mig-150 lesson).

BEGIN;

-- ── 1. The audit trail of every rewrite ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.convergence_synthesis_revisions (
  id                 bigserial   PRIMARY KEY,
  convergence_id     uuid        NOT NULL REFERENCES public.convergence_events(id) ON DELETE CASCADE,
  rule               text        NOT NULL,
  original_synthesis text        NOT NULL,
  revised_synthesis  text        NOT NULL,
  revised_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'convergence_synthesis_revisions_once'
       AND conrelid = 'public.convergence_synthesis_revisions'::regclass
  ) THEN
    ALTER TABLE public.convergence_synthesis_revisions
      ADD CONSTRAINT convergence_synthesis_revisions_once UNIQUE (convergence_id, rule);
  END IF;
END $$;

ALTER TABLE public.convergence_synthesis_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.convergence_synthesis_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.convergence_synthesis_revisions_id_seq FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.convergence_synthesis_revisions IS
  'Every rewrite of a stored convergence_events.synthesis, with the original kept verbatim (mig 165, rev H PR-10). One row per (convergence_id, rule). Service role / SQL Editor only.';

-- ── 2. The rewrite, as a function so it can be re-run and guard-tested ──
CREATE OR REPLACE FUNCTION public.rewrite_convergence_cooccurrence_165()
RETURNS TABLE (recorded integer, rewritten integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_recorded  integer;
  v_rewritten integer;
BEGIN
  WITH target AS (
    SELECT e.id, e.synthesis, e.location, e.bounding_box, e.source_classes
      FROM public.convergence_events e
     WHERE e.corroboration_level = 'sensor-confirmed'
       AND e.synthesis ~* '(corroborat|\mconfirm)'
       AND NOT EXISTS (
             SELECT 1 FROM public.convergence_synthesis_revisions r
              WHERE r.convergence_id = e.id
                AND r.rule = '165_cell_cooccurrence')
  ),
  labels AS (
    SELECT t.id,
           array_agg(CASE x.c
                       WHEN 'media'            THEN 'media-reported'
                       WHEN 'sensor-firms'     THEN 'FIRMS thermal'
                       WHEN 'sensor-viirs-dnb' THEN 'night-lights'
                       WHEN 'sensor-ais'       THEN 'AIS'
                       ELSE regexp_replace(x.c, '^other:', '')
                     END ORDER BY x.ord) AS arr
      FROM target t
      CROSS JOIN LATERAL jsonb_array_elements_text(t.source_classes) WITH ORDINALITY AS x(c, ord)
     GROUP BY t.id
  ),
  phrased AS (
    SELECT t.id,
           t.synthesis AS original_synthesis,
           CASE
             WHEN l.arr IS NULL OR cardinality(l.arr) = 0 THEN 'signals'
             WHEN cardinality(l.arr) = 1 THEN l.arr[1] || ' signals'
             WHEN cardinality(l.arr) = 2 THEN l.arr[1] || ' and ' || l.arr[2] || ' signals'
             ELSE array_to_string(l.arr[1:cardinality(l.arr) - 1], ', ')
                  || ' and ' || l.arr[cardinality(l.arr)] || ' signals'
           END AS classes_text,
           COALESCE(
             round((t.bounding_box->>'lat_max')::numeric - (t.bounding_box->>'lat_min')::numeric)::text,
             '10') AS cell_deg,
           COALESCE(t.location, 'an unnamed location') AS location
      FROM target t
      LEFT JOIN labels l ON l.id = t.id
  )
  INSERT INTO public.convergence_synthesis_revisions
         (convergence_id, rule, original_synthesis, revised_synthesis)
  SELECT p.id,
         '165_cell_cooccurrence',
         p.original_synthesis,
         upper(left(p.classes_text, 1)) || substr(p.classes_text, 2)
           || ' co-occurred within a ' || p.cell_deg || '°×' || p.cell_deg || '° cell around '
           || p.location
           || ' inside 72 hours. Sharing a cell is co-occurrence only: a thermal hot pixel is not a strike, an attack or an outage.'
    FROM phrased p
  ON CONFLICT (convergence_id, rule) DO NOTHING;
  GET DIAGNOSTICS v_recorded = ROW_COUNT;

  -- Only a row whose sentence is still the recorded original: a re-run, or a
  -- row edited since, is left alone.
  UPDATE public.convergence_events e
     SET synthesis = r.revised_synthesis
    FROM public.convergence_synthesis_revisions r
   WHERE r.convergence_id = e.id
     AND r.rule = '165_cell_cooccurrence'
     AND e.synthesis = r.original_synthesis;
  GET DIAGNOSTICS v_rewritten = ROW_COUNT;

  RETURN QUERY SELECT v_recorded, v_rewritten;
END $$;

COMMENT ON FUNCTION public.rewrite_convergence_cooccurrence_165() IS
  'Mig 165 data fix (rev H PR-10): rewrites sensor-confirmed convergence syntheses that claim corroboration/confirmation to a co-occurrence sentence built from stored fields, keeping each original in convergence_synthesis_revisions. Idempotent; returns (recorded, rewritten). Service role only.';

REVOKE EXECUTE ON FUNCTION public.rewrite_convergence_cooccurrence_165() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rewrite_convergence_cooccurrence_165() TO service_role;

-- ── 3. Apply it ─────────────────────────────────────────────────────
-- First apply: expect recorded = rewritten = 286 (plus any row the old code
-- wrote after 2026-09-18). A re-run: 0 · 0.
SELECT * FROM public.rewrite_convergence_cooccurrence_165();

COMMIT;

-- ── VERIFY — ONE query, so the SQL Editor shows every row (it only renders
--    the last statement's result). Paste the rows back; every `pass` must be
--    true. "Success. No rows returned" is not proof.
SELECT n, check_name, expected, actual, pass
  FROM (
    SELECT 1 AS n, 'table convergence_synthesis_revisions exists' AS check_name,
           'true' AS expected,
           (to_regclass('public.convergence_synthesis_revisions') IS NOT NULL)::text AS actual,
           to_regclass('public.convergence_synthesis_revisions') IS NOT NULL AS pass
    UNION ALL
    SELECT 2, 'UNIQUE (convergence_id, rule) — pg_constraint', 'true',
           EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'convergence_synthesis_revisions_once'
                      AND conrelid = 'public.convergence_synthesis_revisions'::regclass
                      AND contype = 'u')::text,
           EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'convergence_synthesis_revisions_once'
                      AND conrelid = 'public.convergence_synthesis_revisions'::regclass
                      AND contype = 'u')
    UNION ALL
    SELECT 3, 'RLS enabled on the revisions table', 'true',
           (SELECT relrowsecurity FROM pg_class
             WHERE oid = 'public.convergence_synthesis_revisions'::regclass)::text,
           (SELECT relrowsecurity FROM pg_class
             WHERE oid = 'public.convergence_synthesis_revisions'::regclass)
    UNION ALL
    SELECT 4, 'anon cannot SELECT the originals', 'false',
           has_table_privilege('anon', 'public.convergence_synthesis_revisions', 'SELECT')::text,
           NOT has_table_privilege('anon', 'public.convergence_synthesis_revisions', 'SELECT')
    UNION ALL
    SELECT 5, 'function rewrite_convergence_cooccurrence_165() exists — pg_proc', 'true',
           (to_regprocedure('public.rewrite_convergence_cooccurrence_165()') IS NOT NULL)::text,
           to_regprocedure('public.rewrite_convergence_cooccurrence_165()') IS NOT NULL
    UNION ALL
    SELECT 6, 'anon / authenticated cannot EXECUTE it', 'false / false',
           has_function_privilege('anon', 'public.rewrite_convergence_cooccurrence_165()', 'EXECUTE')::text
             || ' / ' ||
           has_function_privilege('authenticated', 'public.rewrite_convergence_cooccurrence_165()', 'EXECUTE')::text,
           NOT has_function_privilege('anon', 'public.rewrite_convergence_cooccurrence_165()', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.rewrite_convergence_cooccurrence_165()', 'EXECUTE')
    UNION ALL
    SELECT 7, 'service_role can EXECUTE it', 'true',
           has_function_privilege('service_role', 'public.rewrite_convergence_cooccurrence_165()', 'EXECUTE')::text,
           has_function_privilege('service_role', 'public.rewrite_convergence_cooccurrence_165()', 'EXECUTE')
    UNION ALL
    SELECT 8, 'revisions recorded under rule 165_cell_cooccurrence', '>= 286',
           (SELECT count(*) FROM public.convergence_synthesis_revisions
             WHERE rule = '165_cell_cooccurrence')::text,
           (SELECT count(*) FROM public.convergence_synthesis_revisions
             WHERE rule = '165_cell_cooccurrence') >= 286
    UNION ALL
    SELECT 9, 'rows now carrying the revised sentence = revisions recorded', 'equal',
           (SELECT count(*) FROM public.convergence_events e
              JOIN public.convergence_synthesis_revisions r
                ON r.convergence_id = e.id AND r.rule = '165_cell_cooccurrence'
             WHERE e.synthesis = r.revised_synthesis)::text,
           (SELECT count(*) FROM public.convergence_events e
              JOIN public.convergence_synthesis_revisions r
                ON r.convergence_id = e.id AND r.rule = '165_cell_cooccurrence'
             WHERE e.synthesis = r.revised_synthesis)
           = (SELECT count(*) FROM public.convergence_synthesis_revisions
               WHERE rule = '165_cell_cooccurrence')
    UNION ALL
    SELECT 10, 'sensor-confirmed rows still claiming corroboration/confirmation', '0',
           (SELECT count(*) FROM public.convergence_events
             WHERE corroboration_level = 'sensor-confirmed'
               AND synthesis ~* '(corroborat|\mconfirm)')::text,
           (SELECT count(*) FROM public.convergence_events
             WHERE corroboration_level = 'sensor-confirmed'
               AND synthesis ~* '(corroborat|\mconfirm)') = 0
    UNION ALL
    SELECT 11, 'untouched: single-source honest uses · legacy rows', '7 · 26 (2026-09-18)',
           (SELECT count(*) FROM public.convergence_events
             WHERE corroboration_level = 'single-source'
               AND synthesis ~* '(corroborat|\mconfirm)')::text
             || ' · ' ||
           (SELECT count(*) FROM public.convergence_events
             WHERE corroboration_level IS NULL)::text,
           NULL::boolean
    UNION ALL
    SELECT 12, 'example after (one row)', 'a co-occurrence sentence',
           (SELECT r.revised_synthesis FROM public.convergence_synthesis_revisions r
             WHERE r.rule = '165_cell_cooccurrence'
             ORDER BY r.convergence_id LIMIT 1),
           NULL::boolean
  ) v
 ORDER BY n;
