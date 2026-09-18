-- PR-10 guard tests — Reality Check programme rev H, public-surface truth pass.
--
-- Run in the Supabase SQL Editor AFTER migration 165 is applied. Paste the
-- whole file. It wraps itself in BEGIN … ROLLBACK: the synthetic rows it
-- inserts never survive, and nothing in production changes.
--
-- One NOTICE per assertion. A failing assertion RAISEs and aborts the run;
-- paste back every NOTICE you see (and the error, if any). Each assertion
-- fails if the guard it names is removed from migration 165:
--   E1–E3  existence (pg_class / pg_constraint / pg_proc)
--   G1     the rewrite itself — a sensor-confirmed "strike … corroborated by
--          FIRMS" sentence becomes the co-occurrence sentence
--   G2     the original is kept verbatim in convergence_synthesis_revisions
--   G3     the \mconfirm branch — "Sensor-confirmed strikes …" is rewritten too
--   G4     the level filter — a single-source "awaits physical corroboration"
--          (an honest use) is left alone
--   G5     idempotency — a second run records 0 and rewrites 0
--   G6     UNIQUE (convergence_id, rule) — a second revision row is refused
--   G7     a row edited after its rewrite is not rewritten again
--          (the `synthesis = original_synthesis` predicate)
--   G8     privileges — anon cannot read the originals; anon/authenticated
--          cannot execute the rewrite

BEGIN;

DO $$
DECLARE
  v_strike  uuid;
  v_confirm uuid;
  v_single  uuid;
  v_rec     integer;
  v_rw      integer;
  v_text    text;
  c_strike  constant text := 'GUARD-TEST pr10: reported strikes on a refinery are corroborated by FIRMS thermal anomalies at the site.';
  c_confirm constant text := 'GUARD-TEST pr10: Sensor-confirmed strikes on refinery infrastructure are converging with a standoff.';
  c_single  constant text := 'GUARD-TEST pr10: reported attacks on energy infrastructure rest on media reporting and await physical corroboration.';
BEGIN
  -- ── existence ───────────────────────────────────────────────────
  IF to_regclass('public.convergence_synthesis_revisions') IS NULL THEN
    RAISE EXCEPTION 'E1 FAIL: public.convergence_synthesis_revisions does not exist — apply migration 165 first';
  END IF;
  RAISE NOTICE 'E1 PASS: table public.convergence_synthesis_revisions exists';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'convergence_synthesis_revisions_once'
                    AND conrelid = 'public.convergence_synthesis_revisions'::regclass
                    AND contype = 'u') THEN
    RAISE EXCEPTION 'E2 FAIL: UNIQUE constraint convergence_synthesis_revisions_once missing';
  END IF;
  RAISE NOTICE 'E2 PASS: UNIQUE (convergence_id, rule) present';

  IF to_regprocedure('public.rewrite_convergence_cooccurrence_165()') IS NULL THEN
    RAISE EXCEPTION 'E3 FAIL: function public.rewrite_convergence_cooccurrence_165() missing';
  END IF;
  RAISE NOTICE 'E3 PASS: function public.rewrite_convergence_cooccurrence_165() present';

  -- ── fixtures (rolled back) ──────────────────────────────────────
  INSERT INTO public.convergence_events
         (location, bounding_box, joint_p_value, corroboration_level, source_classes, synthesis)
  VALUES ('(55.0, 35.0)', '{"lat_min": 50, "lat_max": 60, "lon_min": 30, "lon_max": 40}'::jsonb,
          0.15, 'sensor-confirmed', '["media", "sensor-firms"]'::jsonb, c_strike)
  RETURNING id INTO v_strike;

  INSERT INTO public.convergence_events
         (location, bounding_box, joint_p_value, corroboration_level, source_classes, synthesis)
  VALUES ('(25.0, 55.0)', '{"lat_min": 20, "lat_max": 30, "lon_min": 50, "lon_max": 60}'::jsonb,
          0.1, 'sensor-confirmed', '["media", "sensor-firms", "sensor-viirs-dnb"]'::jsonb, c_confirm)
  RETURNING id INTO v_confirm;

  INSERT INTO public.convergence_events
         (location, bounding_box, joint_p_value, corroboration_level, source_classes, synthesis)
  VALUES ('(5.0, 5.0)', '{"lat_min": 0, "lat_max": 10, "lon_min": 0, "lon_max": 10}'::jsonb,
          0.3, 'single-source', '["media"]'::jsonb, c_single)
  RETURNING id INTO v_single;

  SELECT recorded, rewritten INTO v_rec, v_rw FROM public.rewrite_convergence_cooccurrence_165();
  RAISE NOTICE 'first run: recorded %, rewritten % (3 fixtures; 2 are targets)', v_rec, v_rw;

  -- ── G1 the rewrite ──────────────────────────────────────────────
  SELECT synthesis INTO v_text FROM public.convergence_events WHERE id = v_strike;
  IF v_text IS DISTINCT FROM
     'Media-reported and FIRMS thermal signals co-occurred within a 10°×10° cell around (55.0, 35.0) inside 72 hours. Sharing a cell is co-occurrence only: a thermal hot pixel is not a strike, an attack or an outage.' THEN
    RAISE EXCEPTION 'G1 FAIL: strike row not rewritten to the co-occurrence sentence — got: %', v_text;
  END IF;
  RAISE NOTICE 'G1 PASS: "corroborated by FIRMS" strike sentence rewritten to the co-occurrence sentence';

  -- ── G2 the original is kept ─────────────────────────────────────
  SELECT original_synthesis INTO v_text
    FROM public.convergence_synthesis_revisions
   WHERE convergence_id = v_strike AND rule = '165_cell_cooccurrence';
  IF v_text IS DISTINCT FROM c_strike THEN
    RAISE EXCEPTION 'G2 FAIL: original sentence not preserved verbatim — got: %', v_text;
  END IF;
  RAISE NOTICE 'G2 PASS: original sentence kept verbatim in convergence_synthesis_revisions';

  -- ── G3 the confirm branch ───────────────────────────────────────
  SELECT synthesis INTO v_text FROM public.convergence_events WHERE id = v_confirm;
  IF v_text ~* '(corroborat|\mconfirm)'
     OR v_text NOT LIKE 'Media-reported, FIRMS thermal and night-lights signals co-occurred within a 10°×10° cell around (25.0, 55.0)%' THEN
    RAISE EXCEPTION 'G3 FAIL: "Sensor-confirmed strikes" row not rewritten — got: %', v_text;
  END IF;
  RAISE NOTICE 'G3 PASS: "Sensor-confirmed strikes" sentence rewritten (three classes joined A, B and C)';

  -- ── G4 single-source honest use untouched ───────────────────────
  SELECT synthesis INTO v_text FROM public.convergence_events WHERE id = v_single;
  IF v_text IS DISTINCT FROM c_single
     OR EXISTS (SELECT 1 FROM public.convergence_synthesis_revisions WHERE convergence_id = v_single) THEN
    RAISE EXCEPTION 'G4 FAIL: single-source row was rewritten or recorded — got: %', v_text;
  END IF;
  RAISE NOTICE 'G4 PASS: single-source "await physical corroboration" left alone';

  -- ── G5 idempotency ──────────────────────────────────────────────
  SELECT recorded, rewritten INTO v_rec, v_rw FROM public.rewrite_convergence_cooccurrence_165();
  IF v_rec <> 0 OR v_rw <> 0 THEN
    RAISE EXCEPTION 'G5 FAIL: a second run recorded % and rewrote % rows (expected 0 and 0)', v_rec, v_rw;
  END IF;
  RAISE NOTICE 'G5 PASS: second run records 0, rewrites 0';

  -- ── G6 one revision per (convergence_id, rule) ──────────────────
  BEGIN
    INSERT INTO public.convergence_synthesis_revisions
           (convergence_id, rule, original_synthesis, revised_synthesis)
    VALUES (v_strike, '165_cell_cooccurrence', 'dup', 'dup');
    RAISE EXCEPTION 'G6 FAIL: a second revision row for the same (convergence_id, rule) was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'G6 PASS: a second revision row for the same (convergence_id, rule) is refused';
  END;

  -- ── G7 an edited row is not rewritten again ─────────────────────
  UPDATE public.convergence_events SET synthesis = 'GUARD-TEST pr10: edited by hand after the rewrite.'
   WHERE id = v_strike;
  SELECT recorded, rewritten INTO v_rec, v_rw FROM public.rewrite_convergence_cooccurrence_165();
  SELECT synthesis INTO v_text FROM public.convergence_events WHERE id = v_strike;
  IF v_rw <> 0 OR v_text IS DISTINCT FROM 'GUARD-TEST pr10: edited by hand after the rewrite.' THEN
    RAISE EXCEPTION 'G7 FAIL: a row edited after its rewrite was rewritten again (rewritten %, now: %)', v_rw, v_text;
  END IF;
  RAISE NOTICE 'G7 PASS: a row edited after its rewrite is left alone';

  -- ── G8 privileges ───────────────────────────────────────────────
  IF has_table_privilege('anon', 'public.convergence_synthesis_revisions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.convergence_synthesis_revisions', 'SELECT') THEN
    RAISE EXCEPTION 'G8 FAIL: anon or authenticated can SELECT convergence_synthesis_revisions';
  END IF;
  IF has_function_privilege('anon', 'public.rewrite_convergence_cooccurrence_165()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rewrite_convergence_cooccurrence_165()', 'EXECUTE') THEN
    RAISE EXCEPTION 'G8 FAIL: anon or authenticated can EXECUTE rewrite_convergence_cooccurrence_165()';
  END IF;
  RAISE NOTICE 'G8 PASS: originals unreadable and rewrite unexecutable by anon/authenticated';

  RAISE NOTICE 'ALL PR-10 GUARDS PASS (everything above is rolled back)';
END $$;

ROLLBACK;
