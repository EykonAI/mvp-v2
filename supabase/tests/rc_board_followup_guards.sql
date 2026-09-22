-- Reality Check board follow-up guard tests (migration 182)
--
-- Run in the Supabase SQL Editor AFTER applying 182, the whole file. It wraps
-- itself in BEGIN … ROLLBACK and reads the REAL published tick 2026-W37 (run
-- 32) — it creates no tick and writes no Reality Check table.
--
-- PASS SIGNAL: the result pane shows ONE row,
--   result = 'RC board follow-up guards: all assertions passed — …'
-- It is the file's last statement and is reached only when nothing raised;
-- on any failure the editor shows 'RC board follow-up guards FAILED: …'
-- naming the failed ids, and no row. The NOTICE lines (one PASS/FAIL per
-- assertion) are detail.
--
-- LOCKS — safe beside the daily tick (~10:22 UTC). No DDL, and no write to
-- reality_check_runs, reality_check_site_verdicts or reality_check_issues.
-- The outer transaction holds only ACCESS SHARE locks (which conflict with
-- nothing the tick or the ingest takes) until the ROLLBACK, about a second
-- after it starts. The only writes are single-row UPDATEs of refineries
-- inside PL/pgSQL exception blocks that always end by raising, so each one's
-- row lock and ROW EXCLUSIVE table lock are released the moment its block
-- unwinds: milliseconds for the CHECK probes (S1–S5), one accessor call for
-- H3 and N3. The tick only READS refineries, so it never waits on them.
--
-- WHAT IT PROVES (each fails if what it guards is removed or weakened)
--   E1–E4   the four sourced columns and three constraints exist; the
--           accessor is service-role only (anon and authenticated by name —
--           revoking PUBLIC alone removes nothing on Supabase)
--   S1–S5   a name or a part-of cannot be recorded without its source, with a
--           source that does not start from an OSM object, pointing at itself
--           or at a site that does not exist
--   D1–D3   the sourced facts are recorded, and the three W37 sites with no
--           citable name have none invented
--   H1–H5   tick 2026-W37 STILL VERIFIES after 182: stored hash c843ad1e…,
--           recomputed identical at every tier and as the current tick; and
--           names are outside the hash — renaming a W37 member changes the
--           board's label and leaves hash_matches true (H3)
--   N1–N9   the naming rule on W37: Rotterdam by its two refineries, never by
--           a recorded part; remove the part-of record and the name changes
--           (N3, the rule bites); Tuban by its sourced name with the source on
--           the row; the unnamed sites by their frozen centroid, and only
--           when no member has a name; Panipat by its refinery; names joined
--           in the facility-id order the claim statements and pages use
--   L1–L7   the §5 mask below Pro: no W37 lead key, member id, name or
--           coordinate anywhere in the member or public payload — rows, the
--           robustness list and the drill-down echo included — and no
--           masked flip placed among identified ones in the key-ordered
--           robustness list (L4), while Pro still sees them, and the row
--           count still adds up
--   C1–C5   the counts the board's copy renders: heat-not-observable split
--           by why (141 = 63 + 78 at or below the floor + 0 with no usable
--           FIRMS day, on W37) and the claims on the register (55 claims
--           on 19 complexes, 276 verdicts with none), claims only on
--           thermally dark complexes, no US state on any row
--   X1–X2   the re-issued accessor's empty state is unchanged

BEGIN;

DO $guards$
DECLARE
  r_results jsonb := '[]'::jsonb;
  r         record;
  v_failed  text[] := '{}';
  v_total   integer := 0;

  v_run     bigint;
  v_pro     jsonb;
  v_mem     jsonb;
  v_pub     jsonb;
  v_pubdd   jsonb;
  v_cur     jsonb;
  v_t       jsonb;
  v_ok      boolean;
  v_n       integer;
  v_txt     text;
  v_name    text;
  v_leak    text;

  c_w37     CONSTANT text := '2026-W37';
  c_hash    CONSTANT text := 'c843ad1e';
  c_rot     CONSTANT text := 'RFC-N51-E004-3';
  c_tuban   CONSTANT text := 'RFC-S07-E111-1';
BEGIN

-- ═══ E · objects and grants ═══════════════════════════════════════════
SELECT count(*) INTO v_n FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'refineries'
   AND column_name IN ('display_name', 'display_name_source', 'part_of_id', 'part_of_source');
r_results := r_results || jsonb_build_object('id', 'E1',
  'what', 'refineries carries display_name, display_name_source, part_of_id, part_of_source',
  'ok', v_n = 4, 'detail', format('%s of 4', v_n));

SELECT count(*) INTO v_n FROM pg_constraint
 WHERE conrelid = 'public.refineries'::regclass
   AND conname IN ('refineries_display_name_sourced', 'refineries_part_of_sourced', 'refineries_part_of_fkey');
r_results := r_results || jsonb_build_object('id', 'E2',
  'what', 'the two sourcing CHECKs and the part-of foreign key exist',
  'ok', v_n = 3, 'detail', format('%s of 3', v_n));

r_results := r_results || jsonb_build_object('id', 'E3',
  'what', 'anon and authenticated cannot execute the accessor; service_role can',
  'ok', NOT has_function_privilege('anon', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE'));

r_results := r_results || jsonb_build_object('id', 'E4',
  'what', 'the accessor no longer orders names by collation (the rule that picked the process unit)',
  'ok', pg_get_functiondef('public.reality_check_tick(text,text,text,text)'::regprocedure)
          NOT LIKE '%ORDER BY (rf.refinery_name IS NULL), rf.refinery_name%'
    AND pg_get_functiondef('public.reality_check_tick(text,text,text,text)'::regprocedure)
          LIKE '%has_named_whole%');

-- ═══ S · a name or a part-of is never recorded without its source ═════
-- Each probe updates ONE real registry row and must be refused. If a probe
-- is NOT refused, the block raises anyway, so the row is never left
-- changed and its lock is released as the block unwinds.
BEGIN
  UPDATE public.refineries SET display_name = 'probe', display_name_source = NULL WHERE id = 'way:705312467';
  RAISE EXCEPTION 'S1 probe was accepted' USING ERRCODE = 'P0001';
EXCEPTION
  WHEN check_violation THEN v_ok := SQLERRM LIKE '%refineries_display_name_sourced%';
  WHEN OTHERS THEN v_ok := false; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'S1',
  'what', 'a display name without a source is refused by refineries_display_name_sourced',
  'ok', v_ok, 'detail', v_txt);

v_txt := NULL;
BEGIN
  UPDATE public.refineries SET display_name = 'probe', display_name_source = 'looked it up somewhere' WHERE id = 'way:705312467';
  RAISE EXCEPTION 'S2 probe was accepted' USING ERRCODE = 'P0001';
EXCEPTION
  WHEN check_violation THEN v_ok := SQLERRM LIKE '%refineries_display_name_sourced%';
  WHEN OTHERS THEN v_ok := false; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'S2',
  'what', 'a display name whose source does not start from an OSM object (or EIA-820) is refused',
  'ok', v_ok, 'detail', v_txt);

v_txt := NULL;
BEGIN
  UPDATE public.refineries SET part_of_id = 'way:705312467',
         part_of_source = 'OSM way:705312467 — probe' WHERE id = 'way:705312467';
  RAISE EXCEPTION 'S3 probe was accepted' USING ERRCODE = 'P0001';
EXCEPTION
  WHEN check_violation THEN v_ok := SQLERRM LIKE '%refineries_part_of_sourced%';
  WHEN OTHERS THEN v_ok := false; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'S3',
  'what', 'a site cannot be recorded as a part of itself',
  'ok', v_ok, 'detail', v_txt);

v_txt := NULL;
BEGIN
  UPDATE public.refineries SET part_of_id = 'way:0-rc-guard-no-such-site',
         part_of_source = 'OSM way:705312467 — probe' WHERE id = 'way:705312467';
  RAISE EXCEPTION 'S4 probe was accepted' USING ERRCODE = 'P0001';
EXCEPTION
  WHEN foreign_key_violation THEN v_ok := SQLERRM LIKE '%refineries_part_of_fkey%';
  WHEN OTHERS THEN v_ok := false; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'S4',
  'what', 'a part-of pointing at a site that is not in the registry is refused by the foreign key',
  'ok', v_ok, 'detail', v_txt);

v_txt := NULL;
BEGIN
  UPDATE public.refineries SET part_of_id = 'way:144928919', part_of_source = NULL WHERE id = 'way:705312467';
  RAISE EXCEPTION 'S5 probe was accepted' USING ERRCODE = 'P0001';
EXCEPTION
  WHEN check_violation THEN v_ok := SQLERRM LIKE '%refineries_part_of_sourced%';
  WHEN OTHERS THEN v_ok := false; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'S5',
  'what', 'a part-of without its evidence is refused',
  'ok', v_ok, 'detail', v_txt);

-- ═══ D · the sourced facts ═══════════════════════════════════════════
SELECT count(*) INTO v_n FROM public.refineries
 WHERE id IN ('way:614516782', 'way:614516783', 'way:614516785')
   AND display_name = 'Transpacific Petrochemical Indotama'
   AND display_name_source LIKE 'OSM way:604190258 %';
r_results := r_results || jsonb_build_object('id', 'D1',
  'what', 'the three Tuban polygons carry the name of the OSM polygon that encloses them, with its source — and Panipat reads Panipat Refinery (sourced, or because the registry itself now does)',
  'ok', v_n = 3
    AND EXISTS (SELECT 1 FROM public.refineries
                 WHERE id = 'way:259662844'
                   AND (   (display_name = 'Panipat Refinery' AND display_name_source LIKE 'OSM way:259662844 %')
                        OR (display_name IS NULL AND refinery_name = 'Panipat Refinery'))),
  'detail', format('%s of 3 Tuban rows', v_n));

r_results := r_results || jsonb_build_object('id', 'D2',
  'what', 'way:895629447 is recorded as a part of way:144928919 (Gunvor Energy Rotterdam), with its evidence',
  'ok', EXISTS (SELECT 1 FROM public.refineries
                 WHERE id = 'way:895629447' AND part_of_id = 'way:144928919'
                   AND part_of_source LIKE 'OSM way:895629447 %'));

SELECT count(*) INTO v_n FROM public.refineries
 WHERE id IN ('way:1380474666', 'way:705312467', 'way:944039666')
   AND (display_name IS NOT NULL OR refinery_name IS NOT NULL);
r_results := r_results || jsonb_build_object('id', 'D3',
  'what', 'the three W37 sites with no citable source (Baytown TX, Albuquerque NM, Wuhan CN) have no name invented for them',
  'ok', v_n = 0, 'detail', format('%s named', v_n));

-- ═══ H · tick 2026-W37 still verifies ════════════════════════════════
SELECT run_id INTO v_run FROM public.reality_check_issues WHERE tick_slug = c_w37;
IF v_run IS NULL THEN
  RAISE EXCEPTION 'RC board follow-up guards FAILED: tick % is not published — this guard reads the real tick', c_w37;
END IF;
v_pro := public.reality_check_tick('pro',    c_w37);
v_mem := public.reality_check_tick('member', c_w37);
v_pub := public.reality_check_tick('public', c_w37);
v_cur := public.reality_check_tick('pro');

r_results := r_results || jsonb_build_object('id', 'H1',
  'what', 'tick 2026-W37 keeps its published hash (c843ad1e…) and the hash recomputed from its frozen rows is identical',
  'ok', (v_pro->>'published')::boolean IS TRUE
    AND left(v_pro#>>'{integrity,content_hash}', 8) = c_hash
    AND (v_pro#>>'{integrity,hash_matches}')::boolean IS TRUE
    AND v_pro#>>'{integrity,recomputed}' = v_pro#>>'{integrity,content_hash}',
  'detail', format('stored %s · recomputed %s', left(v_pro#>>'{integrity,content_hash}', 16),
                   left(v_pro#>>'{integrity,recomputed}', 16)));

r_results := r_results || jsonb_build_object('id', 'H2',
  'what', 'the member and public reads of 2026-W37 recompute the same hash and verify',
  'ok', (v_mem#>>'{integrity,hash_matches}')::boolean IS TRUE
    AND (v_pub#>>'{integrity,hash_matches}')::boolean IS TRUE
    AND v_mem#>>'{integrity,recomputed}' = v_pro#>>'{integrity,content_hash}'
    AND v_pub#>>'{integrity,recomputed}' = v_pro#>>'{integrity,content_hash}');

-- Names are OUTSIDE the hash (mig 171's not_covered). Rename a W37 member
-- inside a block that always raises: the board's label must follow the
-- registry and the hash must not move.
v_ok := false; v_txt := NULL;
BEGIN
  UPDATE public.refineries
     SET display_name = 'RC guard probe name',
         display_name_source = 'OSM way:146809645 — guard probe, rolled back'
   WHERE id = 'way:146809645';
  v_t := public.reality_check_tick('pro', c_w37);
  SELECT x->>'site_name' INTO v_name FROM jsonb_array_elements(v_t->'rows') x WHERE x->>'cluster_key' = c_rot;
  v_ok := (v_t#>>'{integrity,hash_matches}')::boolean IS TRUE
      AND v_t#>>'{integrity,recomputed}' = v_pro#>>'{integrity,content_hash}'
      AND v_name LIKE '%RC guard probe name%';
  v_txt := format('label %s · hash_matches %s', v_name, v_t#>>'{integrity,hash_matches}');
  RAISE EXCEPTION 'H3 probe undone' USING ERRCODE = 'P0001';
EXCEPTION WHEN raise_exception THEN NULL;
END;
r_results := r_results || jsonb_build_object('id', 'H3',
  'what', 'site names are outside the content hash: renaming a W37 member changes the label and leaves 2026-W37 verified',
  'ok', v_ok, 'detail', v_txt);

SELECT count(*) INTO v_n FROM public.reality_check_site_verdicts WHERE run_id = v_run;
r_results := r_results || jsonb_build_object('id', 'H4',
  'what', 'the frozen W37 rows are all still there and the funnel still reads them (verdicts = watched complexes = rows returned)',
  'ok', v_n = (v_pro#>>'{funnel,watched,complexes}')::int
    AND v_n = jsonb_array_length(v_pro->'rows')
    AND (SELECT status FROM public.reality_check_runs WHERE id = v_run) = 'complete',
  'detail', format('%s verdicts', v_n));

r_results := r_results || jsonb_build_object('id', 'H5',
  'what', 'the current tick verifies too',
  'ok', (v_cur->>'published')::boolean IS TRUE AND (v_cur#>>'{integrity,hash_matches}')::boolean IS TRUE,
  'detail', v_cur->>'tick');

-- ═══ N · the naming rule, on the real tick ═══════════════════════════
SELECT x->>'site_name' INTO v_name FROM jsonb_array_elements(v_pro->'rows') x WHERE x->>'cluster_key' = c_rot;
r_results := r_results || jsonb_build_object('id', 'N1',
  'what', 'the refuted Rotterdam complex is named by its two refineries, as the one-pagers name it — at Pro and below',
  'ok', v_name = 'Gunvor Energy Rotterdam + BP Raffinaderij Rotterdam'
    AND (SELECT x->>'site_name' FROM jsonb_array_elements(v_mem->'rows') x WHERE x->>'cluster_key' = c_rot) = v_name,
  'detail', v_name);

-- no complex on W37 is named after a member recorded as a part while some
-- other member has a name
SELECT count(*) INTO v_n
  FROM public.reality_check_site_verdicts v
  JOIN public.refineries part ON part.id = ANY (v.members)
                             AND part.part_of_id = ANY (v.members)
  JOIN LATERAL (SELECT x->>'site_name' AS n FROM jsonb_array_elements(v_pro->'rows') x
                 WHERE x->>'cluster_key' = v.cluster_key) b ON true
 WHERE v.run_id = v_run
   AND coalesce(part.display_name, part.refinery_name) IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.refineries o
                WHERE o.id = ANY (v.members) AND o.id <> part.id
                  AND (o.part_of_id IS NULL OR NOT (o.part_of_id = ANY (v.members)))
                  AND coalesce(o.display_name, o.refinery_name) IS NOT NULL)
   AND strpos(b.n, coalesce(part.display_name, part.refinery_name)) > 0;
r_results := r_results || jsonb_build_object('id', 'N2',
  'what', 'no W37 complex is named after a recorded part while another member has a name',
  'ok', v_n = 0, 'detail', format('%s complex(es)', v_n));

-- the rule bites: without the part-of record, the unit is back in the name
v_ok := false; v_txt := NULL;
BEGIN
  UPDATE public.refineries SET part_of_id = NULL, part_of_source = NULL WHERE id = 'way:895629447';
  v_t := public.reality_check_tick('pro', c_w37);
  SELECT x->>'site_name' INTO v_txt FROM jsonb_array_elements(v_t->'rows') x WHERE x->>'cluster_key' = c_rot;
  v_ok := v_txt IS DISTINCT FROM 'Gunvor Energy Rotterdam + BP Raffinaderij Rotterdam'
      AND v_txt = 'Gunvor Energy Rotterdam + BP Raffinaderij Rotterdam + 1 more';
  RAISE EXCEPTION 'N3 probe undone' USING ERRCODE = 'P0001';
EXCEPTION WHEN raise_exception THEN NULL;
END;
r_results := r_results || jsonb_build_object('id', 'N3',
  'what', 'remove the part-of record and the process unit counts toward the name again — the rule, not a hard-coded label, produces N1',
  'ok', v_ok, 'detail', v_txt);

SELECT x INTO v_t FROM jsonb_array_elements(v_pro->'rows') x WHERE x->>'cluster_key' = c_tuban;
r_results := r_results || jsonb_build_object('id', 'N4',
  'what', 'the refuted Tuban complex carries its sourced name, and the source travels on the row',
  'ok', v_t->>'site_name' = 'Transpacific Petrochemical Indotama'
    AND jsonb_array_length(v_t->'name_sources') = 1
    AND v_t#>>'{name_sources,0}' LIKE 'OSM way:604190258 %',
  'detail', v_t->>'site_name');

SELECT string_agg(x->>'site_name', ' · ' ORDER BY x->>'cluster_key') INTO v_txt
  FROM jsonb_array_elements(v_pro->'rows') x
 WHERE x->>'cluster_key' IN ('RFC-N29-W096-3', 'RFC-N30-E114-1', 'RFC-N35-W107-1');
r_results := r_results || jsonb_build_object('id', 'N5',
  'what', 'the three refuted sites with no citable name read as their frozen centroid, as the pages print them',
  'ok', v_txt = 'Unnamed site (29.745 N, 95.001 W) · Unnamed site (30.647 N, 114.454 E) · Unnamed site (35.065 N, 106.652 W)',
  'detail', v_txt);

-- the coordinate label is used exactly when no member has a name
SELECT count(*) INTO v_n
  FROM public.reality_check_site_verdicts v
  JOIN LATERAL (SELECT x->>'site_name' AS n FROM jsonb_array_elements(v_pro->'rows') x
                 WHERE x->>'cluster_key' = v.cluster_key) b ON true
 WHERE v.run_id = v_run
   AND (b.n IS NULL OR b.n = ''
        -- a violation when the label and a named member coexist, or when
        -- neither does (a name from nowhere)
        OR ((b.n LIKE 'Unnamed site (%') = EXISTS (
              SELECT 1 FROM public.refineries rf
               WHERE rf.id = ANY (v.members)
                 AND coalesce(rf.display_name, rf.refinery_name) IS NOT NULL))
        OR (b.n LIKE 'Unnamed site (%' AND b.n !~ '^Unnamed site \([0-9]+\.[0-9]{3} [NS], [0-9]+\.[0-9]{3} [EW]\)$'));
r_results := r_results || jsonb_build_object('id', 'N6',
  'what', 'every W37 row has a name, and the coordinate label appears exactly when no member has one',
  'ok', v_n = 0, 'detail', format('%s row(s) off the rule', v_n));

SELECT x->>'site_name' INTO v_txt FROM jsonb_array_elements(v_pro->'rows') x WHERE x->>'cluster_key' = 'RFC-N29-E076-1';
r_results := r_results || jsonb_build_object('id', 'N7',
  'what', 'the Panipat complex is named after its refinery, not the stale unit name "Gasoline"',
  'ok', v_txt = 'Panipat Refinery', 'detail', v_txt);

SELECT x->>'site_name' INTO v_txt FROM jsonb_array_elements(v_pro->'rows') x WHERE x->>'cluster_key' = 'RFC-N37-E015-2';
r_results := r_results || jsonb_build_object('id', 'N9',
  'what', 'names are joined in facility-id order, as the claim statements and the one-pagers print them',
  'ok', v_txt = 'Raffineria ISAB sito nord + Sonatrach Raffineria Italiana', 'detail', v_txt);

-- every Pro row carries every member's name, parts included and labelled
SELECT x INTO v_t FROM jsonb_array_elements(v_pro->'rows') x WHERE x->>'cluster_key' = c_rot;
r_results := r_results || jsonb_build_object('id', 'N8',
  'what', 'the Pro drill-down still lists every member, the part labelled as a part of its refinery',
  'ok', jsonb_array_length(v_t->'member_names') = 3
    AND v_t->'member_names' ? 'amine regeneration sour water strippers (part of Gunvor Energy Rotterdam)',
  'detail', v_t->>'member_names');

-- ═══ L · the lead mask below Pro (§5, D-12) ══════════════════════════
-- Everything that identifies a W37 lead: key, member ids, the names they
-- are known by, and the centroid as the payload would print it.
SELECT string_agg(DISTINCT w.token, ' | ') INTO v_leak
  FROM (
    SELECT v.cluster_key AS k, rf.id, rf.refinery_name, rf.display_name,
           round(c.centroid_lat::numeric, 4)::text AS lat4, round(c.centroid_lon::numeric, 4)::text AS lon4
      FROM public.reality_check_site_verdicts v
      JOIN public.refineries rf ON rf.id = ANY (v.members)
      JOIN public.refinery_complexes c ON c.cluster_key = v.cluster_key
     WHERE v.run_id = v_run AND v.verdict = 'LEAD'
  ) l
  CROSS JOIN LATERAL (VALUES (l.k), ('"' || l.id || '"'), (l.refinery_name), (l.display_name), (l.lat4), (l.lon4)) AS w(token)
 WHERE w.token IS NOT NULL
   AND (strpos(v_mem::text, w.token) > 0 OR strpos(v_pub::text, w.token) > 0);

SELECT count(*) INTO v_n FROM public.reality_check_site_verdicts WHERE run_id = v_run AND verdict = 'LEAD';
r_results := r_results || jsonb_build_object('id', 'L1',
  'what', 'W37 has leads to mask (the test is not vacuous)',
  'ok', v_n >= 1, 'detail', format('%s lead(s)', v_n));

r_results := r_results || jsonb_build_object('id', 'L2',
  'what', 'no W37 lead key, member id, registry or display name, or centroid appears anywhere in the member or public payload',
  'ok', v_leak IS NULL, 'detail', v_leak);

SELECT count(*) INTO v_n FROM jsonb_array_elements(v_mem->'rows') x
 WHERE x->>'verdict' = 'LEAD'
   AND x->'cluster_key' = 'null'::jsonb AND x->'site_name' = 'null'::jsonb
   AND x->'location' = 'null'::jsonb AND x->'members' = 'null'::jsonb
   AND x->'member_names' = 'null'::jsonb AND (x->>'name_masked')::boolean
   AND x->>'row_key' LIKE 'withheld-lead-%';
r_results := r_results || jsonb_build_object('id', 'L3',
  'what', 'each masked lead row keeps its verdict and measurements but withholds name, key, location and members, keyed by an opaque row key',
  'ok', v_n = (SELECT count(*) FROM public.reality_check_site_verdicts WHERE run_id = v_run AND verdict = 'LEAD'),
  'detail', format('%s masked', v_n));

SELECT count(*) INTO v_n FROM jsonb_array_elements(v_mem#>'{robustness,not_robust}') e
 WHERE e->>'verdict' = 'LEAD' AND (e->'cluster_key' <> 'null'::jsonb OR NOT (e->>'name_masked')::boolean);
-- ...and a masked entry is never placed among the identified ones: in a
-- key-ordered list its position would bracket its key between its
-- neighbours'. v_txt = how many masked entries come BEFORE an identified one.
SELECT count(*)::text INTO v_txt
  FROM jsonb_array_elements(v_mem#>'{robustness,not_robust}') WITH ORDINALITY AS a(e, o)
 WHERE (e->>'name_masked')::boolean
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_mem#>'{robustness,not_robust}') WITH ORDINALITY AS b(f, q)
                WHERE q > a.o AND NOT (f->>'name_masked')::boolean);
r_results := r_results || jsonb_build_object('id', 'L4',
  'what', 'the robustness list below Pro keeps every flip but withholds a lead''s key (RFC-N46-W093-1 was printed to every tier), and lists a withheld flip after every identified one so its place cannot bracket its key',
  'ok', v_n = 0 AND v_txt = '0'
    AND jsonb_array_length(v_mem#>'{robustness,not_robust}') = jsonb_array_length(v_pro#>'{robustness,not_robust}'),
  'detail', format('%s unmasked lead flip(s); %s masked flip(s) placed among identified ones', v_n, v_txt));

SELECT cluster_key INTO v_txt FROM public.reality_check_site_verdicts
 WHERE run_id = v_run AND verdict = 'LEAD' ORDER BY cluster_key LIMIT 1;
v_pubdd := public.reality_check_tick('public', c_w37, v_txt);
r_results := r_results || jsonb_build_object('id', 'L5',
  'what', 'a public drill-down request for a lead key is withheld without echoing the key (no lead detector)',
  'ok', (v_pubdd#>>'{drilldown,withheld}')::boolean IS TRUE
    AND v_pubdd#>'{drilldown,cluster_key}' = 'null'::jsonb
    AND strpos(v_pubdd::text, v_txt) = 0);

SELECT count(*) INTO v_n FROM jsonb_array_elements(v_pro->'rows') x
 WHERE x->>'verdict' = 'LEAD' AND x->>'cluster_key' IS NOT NULL
   AND x->>'site_name' IS NOT NULL AND NOT (x->>'name_masked')::boolean;
r_results := r_results || jsonb_build_object('id', 'L6',
  'what', 'Pro still sees every lead by name and key — the mask is by tier, not a deletion',
  'ok', v_n = (SELECT count(*) FROM public.reality_check_site_verdicts WHERE run_id = v_run AND verdict = 'LEAD'));

r_results := r_results || jsonb_build_object('id', 'L7',
  'what', 'below Pro the board still has one row per watched complex, so its counts add up',
  'ok', jsonb_array_length(v_mem->'rows') = (v_mem#>>'{funnel,watched,complexes}')::int
    AND jsonb_array_length(v_pub->'rows') = (v_pub#>>'{funnel,watched,complexes}')::int);

-- ═══ C · the counts the copy renders ═════════════════════════════════
r_results := r_results || jsonb_build_object('id', 'C1',
  'what', 'heat not observable = observed − heat-observable, split into rate at or below the floor with / without baseline detection days, and no usable FIRMS day — counted from the verdicts',
  'ok', (v_pro#>>'{heat_not_observable,complexes}')::int
          = (v_pro#>>'{funnel,observed,complexes}')::int - (v_pro#>>'{funnel,heat_observable,complexes}')::int
    AND (v_pro#>>'{heat_not_observable,with_baseline_detection}')::int
          + (v_pro#>>'{heat_not_observable,without_baseline_detection}')::int
          + (v_pro#>>'{heat_not_observable,without_usable_firms_days}')::int
          = (v_pro#>>'{heat_not_observable,complexes}')::int
    AND (v_pro#>>'{heat_not_observable,with_baseline_detection}')::int
          = (SELECT count(*) FROM public.reality_check_site_verdicts
              WHERE run_id = v_run AND coverage_state = 'OBSERVED'
                AND heat_state = 'HEAT_NOT_OBSERVABLE' AND baseline_heat_days > 0
                AND baseline_heat_rate <= (v_pro#>>'{parameters,heat_observable_floor}')::numeric)
    AND (v_pro#>>'{heat_not_observable,without_usable_firms_days}')::int
          = (SELECT count(*) FROM public.reality_check_site_verdicts
              WHERE run_id = v_run AND coverage_state = 'OBSERVED'
                AND heat_state = 'HEAT_NOT_OBSERVABLE'
                AND (baseline_heat_rate IS NULL
                     OR baseline_heat_rate > (v_pro#>>'{parameters,heat_observable_floor}')::numeric))
    -- and every one of those really lacks a usable FIRMS day (classify.ts heatState)
    AND NOT EXISTS (SELECT 1 FROM public.reality_check_site_verdicts
                     WHERE run_id = v_run AND coverage_state = 'OBSERVED'
                       AND heat_state = 'HEAT_NOT_OBSERVABLE'
                       AND (baseline_heat_rate IS NULL
                            OR baseline_heat_rate > (v_pro#>>'{parameters,heat_observable_floor}')::numeric)
                       AND baseline_firms_days > 0 AND window_firms_days > 0));

r_results := r_results || jsonb_build_object('id', 'C2',
  'what', 'on W37: 141 heat-not-observable complexes, all at or below the 0.20 floor — 63 of them with baseline detection days, 78 without, 0 without a usable FIRMS day',
  'ok', (v_pro#>>'{heat_not_observable,complexes}') = '141'
    AND (v_pro#>>'{heat_not_observable,with_baseline_detection}') = '63'
    AND (v_pro#>>'{heat_not_observable,without_baseline_detection}') = '78'
    AND (v_pro#>>'{heat_not_observable,without_usable_firms_days}') = '0',
  'detail', v_pro->>'heat_not_observable');

r_results := r_results || jsonb_build_object('id', 'C3',
  'what', 'on W37 the register holds 55 claims on 19 complexes, 276 of 295 verdicts carry none, and 55 is the frozen claims_issued',
  'ok', (v_pro#>>'{claims,on_register,claims}') = '55'
    AND (v_pro#>>'{claims,on_register,complexes}') = '19'
    AND (v_pro#>>'{claims,on_register,verdicts_without_claims}') = '276'
    AND (v_pro#>>'{claims,issued_on_this_tick}') = '55',
  'detail', v_pro#>>'{claims,on_register}');

SELECT count(*) INTO v_n
  FROM public.predictions_register p
 WHERE p.source = 'refinery-rc' AND p.context->>'tick_run_id' = v_run::text
   AND NOT EXISTS (SELECT 1 FROM public.reality_check_site_verdicts v
                    WHERE v.run_id = v_run AND v.cluster_key = p.context->>'cluster_key'
                      AND v.verdict IN ('REFUTED', 'LEAD'));
r_results := r_results || jsonb_build_object('id', 'C4',
  'what', 'every W37 claim is on a thermally dark complex (refuted or lead) — the board''s sentence is what the register shows',
  'ok', v_n = 0, 'detail', format('%s claim(s) elsewhere', v_n));

SELECT count(*) INTO v_n
  FROM (SELECT v_pro AS p UNION ALL SELECT v_mem UNION ALL SELECT v_pub) t,
       jsonb_array_elements(t.p->'rows') x
 WHERE x->'location' ? 'us_state';
r_results := r_results || jsonb_build_object('id', 'C5',
  'what', 'no row at any tier prints a US state (the one-pagers print none)',
  'ok', v_n = 0, 'detail', format('%s row(s)', v_n));

-- ═══ X · the empty state is unchanged ════════════════════════════════
v_t := public.reality_check_tick('pro', NULL, NULL, 'power');
r_results := r_results || jsonb_build_object('id', 'X1',
  'what', 'an asset class with no tick answers published = false with a reason, not an error',
  'ok', (v_t->>'published')::boolean IS FALSE AND length(coalesce(v_t->>'empty_reason', '')) > 40
    AND NOT (v_t ? 'rows'));
v_t := public.reality_check_tick('member', '2999-W01');
r_results := r_results || jsonb_build_object('id', 'X2',
  'what', 'an unknown tick id answers published = false and echoes the tick asked for',
  'ok', (v_t->>'published')::boolean IS FALSE AND v_t->>'requested_tick' = '2999-W01');

-- ═══ report ═══════════════════════════════════════════════════════════
FOR r IN
  SELECT x->>'id' AS id, x->>'what' AS what, (x->>'ok')::boolean AS ok, x->>'detail' AS detail
    FROM jsonb_array_elements(r_results) WITH ORDINALITY AS e(x, o)
   ORDER BY o
LOOP
  v_total := v_total + 1;
  IF r.ok THEN
    RAISE NOTICE 'PASS % %', r.id, r.what;
  ELSE
    v_failed := v_failed || r.id;
    RAISE NOTICE 'FAIL % % — %', r.id, r.what, coalesce(r.detail, 'no detail');
  END IF;
END LOOP;
IF cardinality(v_failed) > 0 THEN
  RAISE EXCEPTION 'RC board follow-up guards FAILED: % of % assertions failed: % — details: %',
    cardinality(v_failed), v_total, array_to_string(v_failed, ', '),
    (SELECT string_agg((x->>'id') || ' ' || coalesce(x->>'detail', ''), ' | ')
       FROM jsonb_array_elements(r_results) x WHERE NOT coalesce((x->>'ok')::boolean, false));
END IF;
RAISE NOTICE 'RC board follow-up guards: % of % assertions passed', v_total, v_total;
END
$guards$;

ROLLBACK;

-- Reached only when the block above raised nothing. Paste this row back.
SELECT 'RC board follow-up guards: all assertions passed — E1–E4, S1–S5, D1–D3, H1–H5, N1–N9, L1–L7, C1–C5, X1–X2 (tick 2026-W37 still verifies; the board''s presentation rules are proven by test-rc-board.mjs)' AS result;
