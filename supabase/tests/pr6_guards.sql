-- PR-6 guard tests · the tick object, frozen ticks, superseding ticks and
-- the one read accessor (migration 171)
--
-- Run in the Supabase SQL Editor AFTER applying 171, the whole file. It wraps
-- itself in BEGIN … ROLLBACK: the three synthetic ticks it writes (asset
-- class 'refinery', data-clock nights 2031-03-15 and 2031-03-08, over four
-- complexes that already exist) are undone, and it never mutates a tick it
-- did not create — every refused-mutation assertion is aimed at its own
-- fixture. It leaves production exactly as it found it.
--
-- PASS SIGNAL: the result pane shows ONE row,
--   result = 'PR-6 guards: all assertions passed — …'
-- It is the file's last statement and is reached only when nothing raised;
-- on any failure the editor shows 'PR-6 guards FAILED: …' naming the failed
-- ids, and no row. The NOTICE lines (one PASS/FAIL per assertion) are detail.
--
-- WHAT IT PROVES (each fails if its guard is removed or weakened)
--   E1–E8   the objects of 171 exist with service-role-only grants, and
--           anon / authenticated can execute neither the accessor nor the
--           publisher and can read neither the issues table nor the verdicts
--   N1–N3   no capacity, mean or volume column on any Reality Check relation
--   X1–X3   the honest EMPTY STATE: no tick published, an unknown tick id,
--           and the diagnostic counts that go with them
--   P1–P6   publication: the ISO-week slug, revision 1, the publisher's own
--           report, idempotence (a second call publishes nothing and changes
--           no hash), the parameter block carrying "recall: not measured",
--           and the sweep with no argument picking up an unpublished
--           complete run
--   H1–H4   the content hash: recomputed from the frozen rows it is identical,
--           two reads of the same tick return the same hash and the same
--           rows, and the hash covers the verdicts (a changed verdict would
--           change it — proven on a SECOND, unpublished run)
--   F1–F8   the FUNNEL the accessor publishes equals a direct count over
--           reality_check_site_verdicts for the same tick, term by term, and
--           the outcome terms sum to the thermally dark term
--   M1–M8   FROZEN: UPDATE and DELETE against a published run, its verdicts
--           and its issue are all refused, a verdict cannot be INSERTed into
--           a published tick (on a real, unused cluster key, so the assertion
--           tests the trigger and not a foreign key), and after seven refused
--           mutations the tick is byte-for-byte what it published
--   S1–S6   SUPERSEDING: a late night writes a new run and publishes it as
--           revision 2 (…-r2); the old tick's rows, funnel and hash are
--           untouched; the accessor makes the new one current and links both
--           ways; the old one stays readable and citable
--   K1–K6   the §5 field mask inside the accessor: lead names are Pro-only,
--           refuted names are not; the drill-down is Pro-only; the archive is
--           the current tick only below Pro
--   D1–D6   the drill-down's night semantics: withheld below Pro; every
--           calendar night in the tick's range present; a night outside the
--           census reads NIGHT_NOT_USABLE and a usable night with no row
--           reads NOT_INGESTED — a gap either way, never a zero; and the
--           legend names all eight night states
--   C1–C2   counts_by_verdict carries all eight D-2 states and sums to the
--           verdict rows
--
-- The board's own presentation rules (a treatment for every row state, the
-- refutation as the hero, the §3.4 copy verbatim, the §6 banned strings) are
-- TypeScript and are proven by apps/web/scripts/reality-check/test-rc-board.mjs
-- (CI job reality-check / unit), not here.

BEGIN;

DO $guards$
DECLARE
  r_results jsonb := '[]'::jsonb;
  r         record;
  v_failed  text[] := '{}';
  v_total   integer := 0;

  v_key1 text; v_key2 text; v_key3 text; v_key4 text;
  v_mem1 text[]; v_mem2 text[]; v_mem3 text[];
  v_run1 bigint; v_run2 bigint; v_run3 bigint;
  v_slug1 text; v_slug2 text;
  v_hash1 text; v_hash1b text; v_hash3 text;
  v_pub jsonb; v_pub2 jsonb;
  v_t jsonb; v_t2 jsonb; v_old jsonb; v_mem jsonb; v_pubtier jsonb;
  v_ok boolean; v_n integer; v_txt text;
  v_dd jsonb;

  c_clock   CONSTANT date := DATE '2031-03-15';   -- ISO week 11 of 2031
  c_wstart  CONSTANT date := DATE '2031-03-01';
  c_bend    CONSTANT date := DATE '2031-02-28';
  c_bstart  CONSTANT date := DATE '2031-01-29';
BEGIN

-- ═══ E · objects and grants ═══════════════════════════════════════════
r_results := r_results || jsonb_build_object('id', 'E1',
  'what', 'reality_check_issues exists',
  'ok', to_regclass('public.reality_check_issues') IS NOT NULL);

r_results := r_results || jsonb_build_object('id', 'E2',
  'what', 'the three functions of 171 exist',
  'ok', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('reality_check_issue_digest', 'reality_check_publish_tick',
                              'reality_check_tick', 'reality_check_refuse_mutation')) = 4);

SELECT count(*) INTO v_n FROM pg_trigger t
 WHERE NOT t.tgisinternal
   AND t.tgname IN ('reality_check_runs_frozen', 'reality_check_verdicts_frozen',
                    'reality_check_verdicts_sealed', 'reality_check_issues_frozen');
r_results := r_results || jsonb_build_object('id', 'E3',
  'what', 'the four immutability triggers exist',
  'ok', v_n = 4, 'detail', format('%s of 4', v_n));

r_results := r_results || jsonb_build_object('id', 'E4',
  'what', 'anon cannot execute the accessor',
  'ok', NOT has_function_privilege('anon', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE'));
r_results := r_results || jsonb_build_object('id', 'E5',
  'what', 'authenticated cannot execute the accessor',
  'ok', NOT has_function_privilege('authenticated', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE'));
r_results := r_results || jsonb_build_object('id', 'E6',
  'what', 'service_role can execute the accessor, the publisher and the digest',
  'ok', has_function_privilege('service_role', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.reality_check_publish_tick(bigint)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.reality_check_issue_digest(bigint,jsonb,integer)', 'EXECUTE'));
r_results := r_results || jsonb_build_object('id', 'E7',
  'what', 'anon and authenticated cannot execute the publisher or the digest',
  'ok', NOT has_function_privilege('anon', 'public.reality_check_publish_tick(bigint)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.reality_check_publish_tick(bigint)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.reality_check_issue_digest(bigint,jsonb,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.reality_check_issue_digest(bigint,jsonb,integer)', 'EXECUTE'));
r_results := r_results || jsonb_build_object('id', 'E8',
  'what', 'anon and authenticated can read neither the issues nor the verdicts',
  'ok', NOT has_table_privilege('anon', 'public.reality_check_issues', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.reality_check_issues', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.reality_check_site_verdicts', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.reality_check_site_verdicts', 'SELECT'));

-- ═══ N · the prohibition (§6, D-11) ═══════════════════════════════════
SELECT count(*) INTO v_n FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('reality_check_issues', 'reality_check_runs', 'reality_check_site_verdicts')
   AND column_name ~* '(mean|avg|average|capacity|bpd|barrel|offline|volume)';
r_results := r_results || jsonb_build_object('id', 'N1',
  'what', 'no capacity, mean or volume column on any Reality Check relation',
  'ok', v_n = 0, 'detail', format('%s forbidden column(s)', v_n));

r_results := r_results || jsonb_build_object('id', 'N2',
  'what', 'the issues table has every CHECK 171 names',
  'ok', (SELECT count(*) FROM pg_constraint
          WHERE conrelid = 'public.reality_check_issues'::regclass AND contype = 'c') >= 8);

r_results := r_results || jsonb_build_object('id', 'N3',
  'what', 'tick_slug is unique — two ticks can never share a citable id',
  'ok', EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.reality_check_issues'::regclass
                   AND contype = 'u'
                   AND pg_get_constraintdef(oid) ILIKE '%tick_slug%'));

-- ═══ X · the honest empty state ═══════════════════════════════════════
-- 'power' has no detector and therefore no tick, today or ever under this
-- programme: it exercises the empty path without depending on production
-- being empty.
v_t := public.reality_check_tick('pro', NULL, NULL, 'power');
r_results := r_results || jsonb_build_object('id', 'X1',
  'what', 'no tick for an asset class answers published = false with a reason, not an error and not a zero',
  'ok', (v_t->>'published')::boolean IS FALSE
        AND length(coalesce(v_t->>'empty_reason', '')) > 40
        AND v_t ? 'runs_total' AND v_t ? 'runs_complete'
        AND NOT (v_t ? 'rows') AND NOT (v_t ? 'funnel'),
  'detail', v_t->>'empty_reason');

v_t := public.reality_check_tick('pro', '2999-W01');
r_results := r_results || jsonb_build_object('id', 'X2',
  'what', 'an unknown tick id answers published = false and echoes what was asked for',
  'ok', (v_t->>'published')::boolean IS FALSE AND v_t->>'requested_tick' = '2999-W01'
        AND (v_t->>'empty_reason') ILIKE '%2999-W01%',
  'detail', v_t->>'empty_reason');

r_results := r_results || jsonb_build_object('id', 'X3',
  'what', 'the empty state never invents a funnel term',
  'ok', NOT (v_t ? 'funnel') AND NOT (v_t ? 'integrity') AND NOT (v_t ? 'archive'));

-- ═══ the fixture: three complexes, one tick ═══════════════════════════
SELECT array_agg(cluster_key ORDER BY cluster_key) INTO v_mem1
  FROM (SELECT cluster_key FROM public.refinery_complexes
         WHERE retired_at IS NULL ORDER BY cluster_key LIMIT 4) z;
IF v_mem1 IS NULL OR cardinality(v_mem1) < 4 THEN
  RAISE EXCEPTION 'PR-6 guards cannot run: fewer than 4 active refinery complexes exist';
END IF;
-- key 4 is never written into the tick: M5 needs a key that would INSERT
-- cleanly if the seal were removed, so the assertion tests the TRIGGER and
-- not a foreign key.
v_key1 := v_mem1[1]; v_key2 := v_mem1[2]; v_key3 := v_mem1[3]; v_key4 := v_mem1[4];

SELECT coalesce(array_agg(facility_id ORDER BY facility_id), ARRAY['synthetic-a'])
  INTO v_mem1 FROM public.refinery_complex_members WHERE cluster_key = v_key1 AND left_at IS NULL;
SELECT coalesce(array_agg(facility_id ORDER BY facility_id), ARRAY['synthetic-b'])
  INTO v_mem2 FROM public.refinery_complex_members WHERE cluster_key = v_key2 AND left_at IS NULL;
SELECT coalesce(array_agg(facility_id ORDER BY facility_id), ARRAY['synthetic-c'])
  INTO v_mem3 FROM public.refinery_complex_members WHERE cluster_key = v_key3 AND left_at IS NULL;

INSERT INTO public.reality_check_runs (
  asset_class, status, data_clock_night, window_start, window_end,
  baseline_start, baseline_end, classifier_version, complexes_in_scope)
VALUES ('refinery', 'running', c_clock, c_wstart, c_clock, c_bstart, c_bend, 'pr6-guard', 3)
RETURNING id INTO v_run1;

-- row 1 · REFUTED  (the hero: heat went quiet, the site stayed lit)
INSERT INTO public.reality_check_site_verdicts (
  run_id, cluster_key, members, member_count, verdict, coverage_state,
  baseline_nights, window_nights, baseline_median, window_median,
  baseline_min, baseline_max, window_min, window_max,
  r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
  baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
  ks_tested, ks_d, ks_p)
VALUES (v_run1, v_key1, v_mem1, cardinality(v_mem1), 'REFUTED', 'OBSERVED',
        20, 10, 93.200000, 111.500000, 67.200000, 121.300000, 94.000000, 112.700000,
        8, 5, 93.700000, 95.860000, 'REFUTED',
        30, 8, 15, 0, 'HEAT_DOWN', true, 0.250000, 0.786000);

-- row 2 · LEAD, and NOT robust to the 3x3 retrieval (D-13)
INSERT INTO public.reality_check_site_verdicts (
  run_id, cluster_key, members, member_count, verdict, coverage_state,
  baseline_nights, window_nights, baseline_median, window_median,
  baseline_min, baseline_max, window_min, window_max,
  r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
  baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
  ks_tested, ks_d, ks_p)
VALUES (v_run1, v_key2, v_mem2, cardinality(v_mem2), 'LEAD', 'OBSERVED',
        24, 11, 34.400000, 19.200000, 12.200000, 814.800000, 11.700000, 40.800000,
        8, 5, 93.700000, 80.000000, 'REFUTED',
        30, 10, 15, 0, 'HEAT_DOWN', true, 0.250000, 0.786000);

-- row 3 · VOID_HEAT_NOT_OBSERVABLE (no heat to fall from — never "steady")
INSERT INTO public.reality_check_site_verdicts (
  run_id, cluster_key, members, member_count, verdict, coverage_state,
  baseline_nights, window_nights, baseline_median, window_median,
  baseline_min, baseline_max, window_min, window_max,
  r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
  baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
  ks_tested, ks_d, ks_p)
VALUES (v_run1, v_key3, v_mem3, cardinality(v_mem3), 'VOID_HEAT_NOT_OBSERVABLE', 'OBSERVED',
        12, 9, 218.500000, 210.000000, 200.000000, 240.000000, 190.000000, 230.000000,
        0, 0, NULL, NULL, NULL,
        30, 0, 15, 0, 'HEAT_NOT_OBSERVABLE', NULL, NULL, NULL);

UPDATE public.reality_check_runs
   SET status = 'complete', completed_at = now(), verdicts_written = 3, claims_issued = 3,
       bm_nights_used  = ARRAY[c_wstart, c_wstart + 1]::date[],
       firms_days_used = ARRAY[c_wstart]::date[]
 WHERE id = v_run1;

-- ═══ P · publication ══════════════════════════════════════════════════
v_pub := public.reality_check_publish_tick(v_run1);
SELECT tick_slug, content_hash INTO v_slug1, v_hash1
  FROM public.reality_check_issues WHERE run_id = v_run1;

r_results := r_results || jsonb_build_object('id', 'P1',
  'what', 'the tick publishes, with the ISO week of its data-clock night as the citable id',
  'ok', v_slug1 = '2031-W11' AND v_slug1 = to_char(c_clock, 'IYYY-"W"IW'),
  'detail', coalesce(v_slug1, 'no issue row'));

r_results := r_results || jsonb_build_object('id', 'P2',
  'what', 'the first tick of a night is revision 1 and supersedes nothing',
  'ok', (SELECT revision = 1 AND supersedes_run_id IS NULL
           FROM public.reality_check_issues WHERE run_id = v_run1));

r_results := r_results || jsonb_build_object('id', 'P3',
  'what', 'the publisher reports what it published',
  'ok', jsonb_array_length(v_pub->'published') = 1
        AND (v_pub->'published'->0->>'run_id')::bigint = v_run1
        AND v_pub->'published'->0->>'content_hash' = v_hash1,
  'detail', v_pub::text);

v_pub2 := public.reality_check_publish_tick(v_run1);
SELECT content_hash INTO v_hash1b FROM public.reality_check_issues WHERE run_id = v_run1;
r_results := r_results || jsonb_build_object('id', 'P4',
  'what', 'publishing is idempotent: a second call publishes nothing and changes no hash',
  'ok', jsonb_array_length(v_pub2->'published') = 0
        AND v_pub2->'already_published' @> to_jsonb(v_run1)
        AND v_hash1b = v_hash1
        AND (SELECT count(*) FROM public.reality_check_issues WHERE run_id = v_run1) = 1,
  'detail', v_pub2::text);

r_results := r_results || jsonb_build_object('id', 'P5',
  'what', 'the parameter block is copied from the run, and carries "recall: not measured" (D-10)',
  'ok', (SELECT parameters->>'statistic' = 'median'
              AND parameters->>'light_column' = 'radiance'
              AND parameters->>'light_down_ratio' = '0.60'
              AND parameters->>'recall' = 'not measured'
           FROM public.reality_check_issues WHERE run_id = v_run1),
  'detail', (SELECT parameters::text FROM public.reality_check_issues WHERE run_id = v_run1));

-- ═══ H · the content hash ═════════════════════════════════════════════
r_results := r_results || jsonb_build_object('id', 'H1',
  'what', 'the stored hash is the digest recomputed from the frozen rows',
  'ok', (SELECT content_hash = public.reality_check_issue_digest(run_id, claims, claims_issued)
           FROM public.reality_check_issues WHERE run_id = v_run1));

v_t  := public.reality_check_tick('pro', v_slug1);
v_t2 := public.reality_check_tick('pro', v_slug1);
r_results := r_results || jsonb_build_object('id', 'H2',
  'what', 'a published tick is byte-identical on re-read: same hash, same rows, same funnel',
  'ok', v_t->>'published' = 'true'
        AND (v_t#>>'{integrity,hash_matches}')::boolean
        AND v_t#>'{integrity,content_hash}' = v_t2#>'{integrity,content_hash}'
        AND v_t->'rows'   = v_t2->'rows'
        AND v_t->'funnel' = v_t2->'funnel'
        AND v_t->'counts_by_verdict' = v_t2->'counts_by_verdict',
  'detail', format('hash %s, matches %s', v_t#>>'{integrity,content_hash}', v_t#>>'{integrity,hash_matches}'));

r_results := r_results || jsonb_build_object('id', 'H3',
  'what', 'the accessor reports the hash it recomputed beside the one it stored',
  'ok', v_t#>>'{integrity,content_hash}' = v_t#>>'{integrity,recomputed}'
        AND (v_t#>>'{integrity,frozen}')::boolean);

-- the hash covers the VERDICTS, proven on a second, UNPUBLISHED run: the
-- same parameters and one different verdict must not hash the same
INSERT INTO public.reality_check_runs (
  asset_class, status, data_clock_night, window_start, window_end,
  baseline_start, baseline_end, classifier_version, complexes_in_scope,
  completed_at, verdicts_written, bm_nights_used, firms_days_used)
VALUES ('refinery', 'complete', c_clock - 7, c_wstart - 7, c_clock - 7,
        c_bstart - 7, c_bend - 7, 'pr6-guard', 1, now(), 1,
        ARRAY[c_wstart - 7]::date[], ARRAY[c_wstart - 7]::date[])
RETURNING id INTO v_run3;
INSERT INTO public.reality_check_site_verdicts (
  run_id, cluster_key, members, member_count, verdict, coverage_state,
  baseline_nights, window_nights, baseline_median, window_median,
  baseline_min, baseline_max, window_min, window_max,
  r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
  baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
  ks_tested, ks_d, ks_p)
VALUES (v_run3, v_key1, v_mem1, cardinality(v_mem1), 'REFUTED', 'OBSERVED',
        20, 10, 93.200000, 111.500000, 67.200000, 121.300000, 94.000000, 112.700000,
        8, 5, 93.700000, 95.860000, 'REFUTED',
        30, 8, 15, 0, 'HEAT_DOWN', true, 0.250000, 0.786000);
v_hash3 := public.reality_check_issue_digest(v_run3, 'null'::jsonb, NULL);
UPDATE public.reality_check_site_verdicts
   SET window_median = 111.600000
 WHERE run_id = v_run3 AND cluster_key = v_key1;
r_results := r_results || jsonb_build_object('id', 'H4',
  'what', 'the hash covers the verdict rows: changing one measurement changes it',
  'ok', public.reality_check_issue_digest(v_run3, 'null'::jsonb, NULL) <> v_hash3);

-- the sweep with no argument picks up the complete run nobody published
v_pub2 := public.reality_check_publish_tick();
r_results := r_results || jsonb_build_object('id', 'P6',
  'what', 'the publisher with no argument sweeps up every complete, unpublished tick',
  'ok', (SELECT count(*) FROM public.reality_check_issues WHERE run_id = v_run3) = 1
        AND v_pub2->'already_published' @> to_jsonb(v_run1),
  'detail', v_pub2::text);

-- ═══ F · the funnel equals a direct count over the verdicts ═══════════
v_t := public.reality_check_tick('pro', v_slug1);
r_results := r_results || jsonb_build_object('id', 'F1',
  'what', 'watched = every verdict row of the tick, with its facility rows',
  'ok', (v_t#>>'{funnel,watched,complexes}')::int =
          (SELECT count(*)::int FROM public.reality_check_site_verdicts WHERE run_id = v_run1)
    AND (v_t#>>'{funnel,watched,rows}')::int =
          (SELECT sum(member_count)::int FROM public.reality_check_site_verdicts WHERE run_id = v_run1));
r_results := r_results || jsonb_build_object('id', 'F2',
  'what', 'observed = the rows the tick stored as OBSERVED',
  'ok', (v_t#>>'{funnel,observed,complexes}')::int =
          (SELECT count(*)::int FROM public.reality_check_site_verdicts
            WHERE run_id = v_run1 AND coverage_state = 'OBSERVED'));
r_results := r_results || jsonb_build_object('id', 'F3',
  'what', 'heat-observable excludes exactly the HEAT_NOT_OBSERVABLE rows',
  'ok', (v_t#>>'{funnel,heat_observable,complexes}')::int = 2
    AND (v_t#>>'{funnel,heat_observable,complexes}')::int =
          (SELECT count(*)::int FROM public.reality_check_site_verdicts
            WHERE run_id = v_run1 AND coverage_state = 'OBSERVED'
              AND heat_state IS DISTINCT FROM 'HEAT_NOT_OBSERVABLE'));
r_results := r_results || jsonb_build_object('id', 'F4',
  'what', 'thermally dark = the HEAT_DOWN rows',
  'ok', (v_t#>>'{funnel,thermally_dark,complexes}')::int = 2);
r_results := r_results || jsonb_build_object('id', 'F5',
  'what', 'the outcome reads 1 refuted, 1 lead, 0 withheld',
  'ok', (v_t#>>'{funnel,refuted,complexes}')::int = 1
    AND (v_t#>>'{funnel,lead,complexes}')::int = 1
    AND (v_t#>>'{funnel,withheld,complexes}')::int = 0);
r_results := r_results || jsonb_build_object('id', 'F6',
  'what', 'the outcome terms sum to the thermally dark term, in complexes and in rows',
  'ok', (v_t#>>'{funnel,refuted,complexes}')::int + (v_t#>>'{funnel,lead,complexes}')::int
          + (v_t#>>'{funnel,withheld,complexes}')::int = (v_t#>>'{funnel,thermally_dark,complexes}')::int
    AND (v_t#>>'{funnel,refuted,rows}')::int + (v_t#>>'{funnel,lead,rows}')::int
          + (v_t#>>'{funnel,withheld,rows}')::int = (v_t#>>'{funnel,thermally_dark,rows}')::int);
r_results := r_results || jsonb_build_object('id', 'F7',
  'what', 'the funnel narrows term by term',
  'ok', (v_t#>>'{funnel,watched,complexes}')::int >= (v_t#>>'{funnel,observed,complexes}')::int
    AND (v_t#>>'{funnel,observed,complexes}')::int >= (v_t#>>'{funnel,heat_observable,complexes}')::int
    AND (v_t#>>'{funnel,heat_observable,complexes}')::int >= (v_t#>>'{funnel,thermally_dark,complexes}')::int);
r_results := r_results || jsonb_build_object('id', 'F8',
  'what', 'the 3x3 robustness funnel names the verdict that flips (D-13)',
  'ok', jsonb_array_length(v_t#>'{robustness,not_robust}') = 1
    AND v_t#>>'{robustness,not_robust,0,cluster_key}' = v_key2
    AND v_t#>>'{robustness,not_robust,0,verdict}' = 'LEAD'
    AND v_t#>>'{robustness,not_robust,0,robustness_verdict}' = 'REFUTED',
  'detail', (v_t#>'{robustness,not_robust}')::text);

-- ═══ C · counts by verdict ════════════════════════════════════════════
r_results := r_results || jsonb_build_object('id', 'C1',
  'what', 'counts_by_verdict carries all eight D-2 states, zeros included',
  'ok', (SELECT count(*) FROM jsonb_object_keys(v_t->'counts_by_verdict')) = 8
    AND v_t#>>'{counts_by_verdict,STEADY}' = '0'
    AND v_t#>>'{counts_by_verdict,REFUTED}' = '1'
    AND v_t#>>'{counts_by_verdict,LEAD}' = '1'
    AND v_t#>>'{counts_by_verdict,VOID_HEAT_NOT_OBSERVABLE}' = '1');
SELECT sum((value)::int) INTO v_n FROM jsonb_each_text(v_t->'counts_by_verdict');
r_results := r_results || jsonb_build_object('id', 'C2',
  'what', 'the counts sum to the verdict rows of the tick',
  'ok', v_n = 3, 'detail', format('%s', v_n));

-- ═══ M · FROZEN ═══════════════════════════════════════════════════════
v_ok := false;
BEGIN
  UPDATE public.reality_check_runs SET verdicts_written = 99 WHERE id = v_run1;
EXCEPTION WHEN OTHERS THEN v_ok := true; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'M1',
  'what', 'UPDATE against a published run is refused', 'ok', v_ok, 'detail', v_txt);

v_ok := false;
BEGIN
  DELETE FROM public.reality_check_runs WHERE id = v_run1;
EXCEPTION WHEN OTHERS THEN v_ok := true; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'M2',
  'what', 'DELETE against a published run is refused', 'ok', v_ok, 'detail', v_txt);

v_ok := false;
BEGIN
  UPDATE public.reality_check_site_verdicts SET window_median = 1.000000
   WHERE run_id = v_run1 AND cluster_key = v_key1;
EXCEPTION WHEN OTHERS THEN v_ok := true; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'M3',
  'what', 'UPDATE against a published verdict is refused', 'ok', v_ok, 'detail', v_txt);

v_ok := false;
BEGIN
  DELETE FROM public.reality_check_site_verdicts WHERE run_id = v_run1 AND cluster_key = v_key1;
EXCEPTION WHEN OTHERS THEN v_ok := true; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'M4',
  'what', 'DELETE against a published verdict is refused', 'ok', v_ok, 'detail', v_txt);

v_ok := false;
BEGIN
  INSERT INTO public.reality_check_site_verdicts (
    run_id, cluster_key, members, member_count, verdict, coverage_state,
    baseline_nights, window_nights, baseline_median, window_median,
    baseline_min, baseline_max, window_min, window_max,
    r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
    baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
    ks_tested, ks_d, ks_p)
  VALUES (v_run1, v_key1 || '-extra', ARRAY['x'], 1, 'STEADY', 'OBSERVED',
          20, 10, 93.200000, 111.500000, 67.200000, 121.300000, 94.000000, 112.700000,
          8, 5, 93.700000, 95.860000, 'STEADY',
          30, 8, 15, 8, 'HEAT_STEADY', true, 0.250000, 0.786000);
EXCEPTION WHEN OTHERS THEN v_ok := true; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'M5',
  'what', 'a verdict cannot be ADDED to a published tick', 'ok', v_ok, 'detail', v_txt);

v_ok := false;
BEGIN
  UPDATE public.reality_check_issues SET refuted_complexes = 99 WHERE run_id = v_run1;
EXCEPTION WHEN OTHERS THEN v_ok := true; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'M6',
  'what', 'UPDATE against a published issue is refused', 'ok', v_ok, 'detail', v_txt);

v_ok := false;
BEGIN
  DELETE FROM public.reality_check_issues WHERE run_id = v_run1;
EXCEPTION WHEN OTHERS THEN v_ok := true; v_txt := SQLERRM;
END;
r_results := r_results || jsonb_build_object('id', 'M7',
  'what', 'DELETE against a published issue is refused', 'ok', v_ok, 'detail', v_txt);

r_results := r_results || jsonb_build_object('id', 'M8',
  'what', 'after seven refused mutations the tick is exactly as published',
  'ok', (SELECT content_hash FROM public.reality_check_issues WHERE run_id = v_run1) = v_hash1
    AND (SELECT count(*) FROM public.reality_check_site_verdicts WHERE run_id = v_run1) = 3
    AND (SELECT verdicts_written FROM public.reality_check_runs WHERE id = v_run1) = 3);

-- ═══ S · a late night publishes a SUPERSEDING tick ════════════════════
-- The same data clock and the same windows, recomputed: the late night turns
-- the lead into a refutation. Nothing about the old tick may move.
INSERT INTO public.reality_check_runs (
  asset_class, status, data_clock_night, window_start, window_end,
  baseline_start, baseline_end, supersedes_run_id, classifier_version, complexes_in_scope)
VALUES ('refinery', 'running', c_clock, c_wstart, c_clock, c_bstart, c_bend, v_run1, 'pr6-guard', 3)
RETURNING id INTO v_run2;

INSERT INTO public.reality_check_site_verdicts (
  run_id, cluster_key, members, member_count, verdict, coverage_state,
  baseline_nights, window_nights, baseline_median, window_median,
  baseline_min, baseline_max, window_min, window_max,
  r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
  baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
  ks_tested, ks_d, ks_p)
SELECT v_run2, cluster_key, members, member_count,
       CASE WHEN cluster_key = v_key2 THEN 'REFUTED' ELSE verdict END,
       coverage_state,
       baseline_nights, CASE WHEN cluster_key = v_key2 THEN 12 ELSE window_nights END,
       baseline_median, CASE WHEN cluster_key = v_key2 THEN 30.000000 ELSE window_median END,
       baseline_min, baseline_max,
       CASE WHEN cluster_key = v_key2 THEN 11.700000 ELSE window_min END,
       CASE WHEN cluster_key = v_key2 THEN 40.800000 ELSE window_max END,
       r3_baseline_nights, r3_window_nights, r3_baseline_median, r3_window_median, robustness_verdict,
       baseline_firms_days, baseline_heat_days, window_firms_days, window_heat_days, heat_state,
       ks_tested, ks_d, ks_p
  FROM public.reality_check_site_verdicts WHERE run_id = v_run1;

UPDATE public.reality_check_runs
   SET status = 'complete', completed_at = now(), verdicts_written = 3,
       bm_nights_used  = ARRAY[c_wstart, c_wstart + 1, c_wstart + 2]::date[],
       firms_days_used = ARRAY[c_wstart]::date[]
 WHERE id = v_run2;

v_pub2 := public.reality_check_publish_tick(v_run2);
SELECT tick_slug INTO v_slug2 FROM public.reality_check_issues WHERE run_id = v_run2;

r_results := r_results || jsonb_build_object('id', 'S1',
  'what', 'the superseding tick publishes as revision 2 of the same ISO week',
  'ok', v_slug2 = '2031-W11-r2'
    AND (SELECT revision = 2 AND supersedes_run_id = v_run1
           FROM public.reality_check_issues WHERE run_id = v_run2),
  'detail', coalesce(v_slug2, 'no issue row'));

r_results := r_results || jsonb_build_object('id', 'S2',
  'what', 'the old tick was not mutated: same hash, same rows, same verdict on the row that moved',
  'ok', (SELECT content_hash FROM public.reality_check_issues WHERE run_id = v_run1) = v_hash1
    AND (SELECT verdict FROM public.reality_check_site_verdicts
          WHERE run_id = v_run1 AND cluster_key = v_key2) = 'LEAD'
    AND (SELECT lead_complexes FROM public.reality_check_issues WHERE run_id = v_run1) = 1);

v_old := public.reality_check_tick('pro', v_slug1);
v_t   := public.reality_check_tick('pro', v_slug2);
r_results := r_results || jsonb_build_object('id', 'S3',
  'what', 'the accessor makes the new tick current and links both ways',
  'ok', (v_t#>>'{supersession,current}')::boolean IS TRUE
    AND v_t#>>'{supersession,supersedes}' = v_slug1
    AND (v_old#>>'{supersession,current}')::boolean IS FALSE
    AND v_old#>>'{supersession,superseded_by,tick}' = v_slug2,
  'detail', format('new %s / old %s', (v_t->'supersession')::text, (v_old->'supersession')::text));

r_results := r_results || jsonb_build_object('id', 'S4',
  'what', 'the superseded tick stays readable and citable, with its own numbers',
  'ok', v_old->>'published' = 'true'
    AND (v_old#>>'{integrity,hash_matches}')::boolean
    AND (v_old#>>'{funnel,lead,complexes}')::int = 1
    AND (v_t#>>'{funnel,lead,complexes}')::int = 0
    AND (v_t#>>'{funnel,refuted,complexes}')::int = 2);

v_t2 := public.reality_check_tick('pro');
r_results := r_results || jsonb_build_object('id', 'S5',
  'what', 'asking for "the" tick answers the newest one nothing supersedes',
  'ok', v_t2->>'tick' = v_slug2, 'detail', v_t2->>'tick');

r_results := r_results || jsonb_build_object('id', 'S6',
  'what', 'both ticks appear in the Pro archive, marked current and superseded',
  'ok', (SELECT count(*) FROM jsonb_array_elements(v_t->'archive') a
          WHERE a->>'tick' IN (v_slug1, v_slug2)) = 2
    AND (SELECT (a->>'current')::boolean FROM jsonb_array_elements(v_t->'archive') a
          WHERE a->>'tick' = v_slug1) IS FALSE
    AND (SELECT (a->>'current')::boolean FROM jsonb_array_elements(v_t->'archive') a
          WHERE a->>'tick' = v_slug2) IS TRUE);

-- ═══ K · the §5 field mask, enforced inside the accessor ══════════════
v_t   := public.reality_check_tick('pro',    v_slug1);
v_mem := public.reality_check_tick('member', v_slug1);
v_pubtier := public.reality_check_tick('public', v_slug1);

r_results := r_results || jsonb_build_object('id', 'K1',
  'what', 'Pro sees the lead complex by name',
  'ok', (SELECT (x->>'name_masked')::boolean IS FALSE AND x->>'site_name' IS NOT NULL
           FROM jsonb_array_elements(v_t->'rows') x WHERE x->>'cluster_key' = v_key2));
r_results := r_results || jsonb_build_object('id', 'K2',
  'what', 'Member and public get the lead as a count, never a name (D-12)',
  'ok', (SELECT (x->>'name_masked')::boolean IS TRUE AND x->>'site_name' IS NULL
                AND x->'location' = 'null'::jsonb
           FROM jsonb_array_elements(v_mem->'rows') x WHERE x->>'cluster_key' = v_key2)
    AND (SELECT (x->>'name_masked')::boolean IS TRUE AND x->>'site_name' IS NULL
           FROM jsonb_array_elements(v_pubtier->'rows') x WHERE x->>'cluster_key' = v_key2));
r_results := r_results || jsonb_build_object('id', 'K3',
  'what', 'every tier sees the REFUTED complexes by name, with both medians and both windows',
  'ok', (SELECT x->>'site_name' IS NOT NULL
                AND x#>>'{light,baseline_median}' IS NOT NULL
                AND x#>>'{light,window_median}' IS NOT NULL
           FROM jsonb_array_elements(v_pubtier->'rows') x WHERE x->>'cluster_key' = v_key1)
    AND v_pubtier#>>'{windows,baseline_start}' IS NOT NULL
    AND v_pubtier#>>'{windows,window_end}' IS NOT NULL
    AND v_pubtier#>>'{parameters,light_down_ratio}' IS NOT NULL
    AND v_pubtier#>>'{funnel,refuted,complexes}' = '1');
r_results := r_results || jsonb_build_object('id', 'K4',
  'what', 'the lead COUNT is published to every tier — only the name is withheld',
  'ok', v_pubtier#>>'{funnel,lead,complexes}' = '1' AND v_mem#>>'{funnel,lead,complexes}' = '1');
r_results := r_results || jsonb_build_object('id', 'K5',
  'what', 'the archive is the current tick only below Pro, all ticks at Pro',
  'ok', jsonb_array_length(v_mem->'archive') = 1
    AND jsonb_array_length(v_pubtier->'archive') = 1
    AND jsonb_array_length(v_t->'archive') >= 2);
r_results := r_results || jsonb_build_object('id', 'K6',
  'what', 'an unknown tier is treated as public, never as Pro',
  'ok', public.reality_check_tick('desk-admin-whatever', v_slug1)->>'tier' = 'public'
    AND (SELECT (x->>'name_masked')::boolean
           FROM jsonb_array_elements(public.reality_check_tick('', v_slug1)->'rows') x
          WHERE x->>'cluster_key' = v_key2) IS TRUE);

-- ═══ D · the drill-down's night semantics ═════════════════════════════
v_dd := public.reality_check_tick('member', v_slug1, v_key1);
r_results := r_results || jsonb_build_object('id', 'D1',
  'what', 'the drill-down is withheld below Pro, and says so',
  'ok', (v_dd#>>'{drilldown,withheld}')::boolean IS TRUE
    AND (v_dd#>>'{drilldown,reason}') ILIKE '%Pro%',
  'detail', (v_dd->'drilldown')::text);

v_dd := public.reality_check_tick('pro', v_slug1, v_key1);
r_results := r_results || jsonb_build_object('id', 'D2',
  'what', 'the drill-down carries EVERY calendar night of the tick, not only the ones with data',
  'ok', jsonb_array_length(v_dd#>'{drilldown,nights}') = (c_clock - c_bstart) + 1,
  'detail', format('%s nights, expected %s',
                   jsonb_array_length(v_dd#>'{drilldown,nights}'), (c_clock - c_bstart) + 1));

SELECT count(*) INTO v_n
  FROM jsonb_array_elements(v_dd#>'{drilldown,nights}') n
 WHERE n->>'light_state' = 'NIGHT_NOT_USABLE';
r_results := r_results || jsonb_build_object('id', 'D3',
  'what', 'a night the census never made usable reads NIGHT_NOT_USABLE — a night not looked at',
  'ok', v_n = ((c_clock - c_bstart) + 1) - 2,
  'detail', format('%s of %s', v_n, (c_clock - c_bstart) + 1));

SELECT count(*) INTO v_n
  FROM jsonb_array_elements(v_dd#>'{drilldown,nights}') n
 WHERE n->>'light_state' = 'NOT_INGESTED' AND n->>'radiance_median' IS NULL;
r_results := r_results || jsonb_build_object('id', 'D4',
  'what', 'a usable night with no row for this complex reads NOT_INGESTED with a NULL value — a gap, never a zero',
  'ok', v_n = 2, 'detail', format('%s of the 2 usable nights', v_n));

SELECT count(*) INTO v_n
  FROM jsonb_array_elements(v_dd#>'{drilldown,nights}') n
 WHERE n->>'radiance_median' = '0' OR n->>'detecting_members' = '0';
r_results := r_results || jsonb_build_object('id', 'D5',
  'what', 'no night that was not looked at is rendered as a zero',
  'ok', v_n = 0, 'detail', format('%s zero-valued gap night(s)', v_n));

r_results := r_results || jsonb_build_object('id', 'D6',
  'what', 'the drill-down ships the legend that names every night state',
  'ok', (SELECT count(*) FROM jsonb_object_keys(v_dd#>'{drilldown,legend}')) = 8);

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
  RAISE EXCEPTION 'PR-6 guards FAILED: % of % assertions failed: % — details: %',
    cardinality(v_failed), v_total, array_to_string(v_failed, ', '),
    (SELECT string_agg((x->>'id') || ' ' || coalesce(x->>'detail', ''), ' | ')
       FROM jsonb_array_elements(r_results) x WHERE NOT (x->>'ok')::boolean);
END IF;
RAISE NOTICE 'PR-6 guards: % of % assertions passed', v_total, v_total;
END
$guards$;

ROLLBACK;

-- Reached only when the block above raised nothing. Paste this row back.
SELECT 'PR-6 guards: all assertions passed — E1–E8, N1–N3, X1–X3, P1–P6, H1–H4, F1–F8, C1–C2, M1–M8, S1–S6, K1–K6, D1–D6 (the board''s presentation rules are proven by test-rc-board.mjs)' AS result,
       now() AS checked_at;
