-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 171 · The tick object: reality_check_issues, frozen-tick
--             immutability, superseding ticks and the ONE read accessor
--             (Reality Check programme, PR-6; D-3, D-12, D-13, §3.3, §5)
--
-- PURPOSE
-- PR-1 (mig 161) gave the tick a place to write; PR-5 (migs 169–170) made it
-- write. This migration turns a written tick into a PUBLISHED OBJECT:
--
--   1 · reality_check_issues — one row per published tick: the five funnel
--       terms counted by complex with facility rows beside them (§2.2), the
--       pinned parameter block, the counts by verdict, the 3x3 robustness
--       funnel, the claims line as at publication, and a content hash over
--       the whole tick.
--
--   2 · FROZEN TICKS (§3.3, "a cited board must never silently change"). Once
--       an issue row exists for a run, that run, its verdicts and its issue
--       can never be updated or deleted, no verdict can be added to it, and
--       none of the three tables can be TRUNCATEd (the one delete path a
--       FOR EACH ROW trigger never sees, and one service_role holds).
--       Enforced by triggers, for every role including service_role — a guard
--       that lives in application code is a comment.
--
--   3 · SUPERSEDING TICKS. A late-arriving night never edits a tick: PR-5's
--       tick writes a NEW run carrying supersedes_run_id, and this migration
--       publishes it as a new issue (revision 2, slug …-r2). The old tick
--       stays readable and citable for ever; the accessor says which is
--       current and links both ways. Nothing is stored about being
--       superseded — it is derived at read time, because storing it would
--       mean UPDATEing a frozen row.
--
--   4 · ONE READ ACCESSOR (§5.3). reality_check_tick() is the single surface
--       the board reads today and the BRIEFS issue (PR-7) and
--       query_reality_check (PR-8) will read tomorrow, with the §5 field mask
--       applied inside it — public / member / pro. There is NO second copy of
--       the classifier anywhere: this function reads what the tick wrote, and
--       classifies nothing.
--
-- THE FIELD MASK (§5, D-12) — enforced here, never in the caller:
--   term                                   public   member   pro
--   funnel terms, parameters, windows      yes      yes      yes
--   refuted: names, both medians, windows  yes      yes      yes
--   lead: names                            count    count    yes
--   drill-down: strips, nights not looked  no       no       yes
--   tick archive                           current  current  all
--
-- NOT HERE. No capacity figure, anywhere, in any shape (§6, D-11): the
-- accessor emits a constant "Capacity not established" object with its
-- reason, and this migration creates no capacity column. No mean over
-- radiance (§3.2 guard 1, scripts/reality-check/check-no-mean.mjs). No
-- detector, no claim issuer, no public route (PR-7).
--
-- Idempotent. No temp tables, no session state (the mig-150 lesson). Apply
-- MANUALLY in the Supabase SQL Editor, the whole file, AFTER 161, 169 and
-- 170, BEFORE merge.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1 · The published tick ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reality_check_issues (
  run_id                     bigint      PRIMARY KEY REFERENCES public.reality_check_runs (id),
  -- the citable id. ISO week of the data-clock night; a superseding tick of
  -- the same night appends its revision (2026-W38, 2026-W38-r2, …). Two new
  -- ticks are >= 7 nights apart, so they can never share an ISO week.
  tick_slug                  text        NOT NULL UNIQUE,
  revision                   integer     NOT NULL DEFAULT 1,
  asset_class                text        NOT NULL,
  data_clock_night           date        NOT NULL,
  window_start               date        NOT NULL,
  window_end                 date        NOT NULL,
  baseline_start             date        NOT NULL,
  baseline_end               date        NOT NULL,
  supersedes_run_id          bigint      REFERENCES public.reality_check_runs (id),

  -- the pinned method, copied from the run row at publication so every
  -- surface renders the tick's own parameters and never a constant (§3.1)
  parameters                 jsonb       NOT NULL,

  -- the five funnel terms (§2.2), COUNTED BY COMPLEX, with the facility
  -- rows of those complexes in brackets. The outcome term is split into
  -- refuted / lead / withheld, and the refuted count is the one the board
  -- makes dominant (§3.3).
  watched_complexes          integer     NOT NULL,
  watched_rows               integer     NOT NULL,
  observed_complexes         integer     NOT NULL,
  observed_rows              integer     NOT NULL,
  heat_observable_complexes  integer     NOT NULL,
  heat_observable_rows       integer     NOT NULL,
  thermally_dark_complexes   integer     NOT NULL,
  thermally_dark_rows        integer     NOT NULL,
  refuted_complexes          integer     NOT NULL,
  refuted_rows               integer     NOT NULL,
  lead_complexes             integer     NOT NULL,
  lead_rows                  integer     NOT NULL,
  -- thermally dark but refused a verdict (VOID_*): withheld, never silently
  -- dropped from the funnel. "Silence is not a verdict."
  withheld_complexes         integer     NOT NULL,
  withheld_rows              integer     NOT NULL,

  counts_by_verdict          jsonb       NOT NULL,   -- all 8 D-2 states, zeros included
  robustness                 jsonb       NOT NULL,   -- the 3x3 funnel + the rows that flip (D-13)
  claims_issued              integer,                -- NULL = not an issuing tick
  claims                     jsonb       NOT NULL,   -- refinery_rc_walkforward() AS AT publication
  content_hash               text        NOT NULL,
  -- the column names the hash was taken over, frozen with it. A LATER
  -- migration that adds a column to reality_check_runs or
  -- reality_check_site_verdicts must not make every published tick read
  -- "DOES NOT MATCH": the row data did not change, the table did. The digest
  -- projects each row down to these keys, so a column added after
  -- publication is outside the tick and a column REMOVED after publication
  -- still breaks the hash, which is the honest answer in both directions.
  digest_keys                jsonb       NOT NULL,
  published_at               timestamptz NOT NULL DEFAULT now()
);

-- idempotency for a re-run after a partial apply (the table above is only
-- created once, so this is the path that adds the column to an existing one)
ALTER TABLE public.reality_check_issues ADD COLUMN IF NOT EXISTS digest_keys jsonb;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'reality_check_issues'
                AND column_name = 'digest_keys' AND is_nullable = 'YES')
     AND NOT EXISTS (SELECT 1 FROM public.reality_check_issues WHERE digest_keys IS NULL) THEN
    ALTER TABLE public.reality_check_issues ALTER COLUMN digest_keys SET NOT NULL;
  END IF;
END $$;

COMMENT ON TABLE public.reality_check_issues IS
  'Reality Check PR-6 (mig 171). One row per PUBLISHED tick — the object the board, the BRIEFS issue and the analyst tool all read through reality_check_tick(). Frozen: an issue row, its run and its verdicts can never be updated, deleted or truncated once this row exists (triggers below). A late night publishes a NEW issue that supersedes this one; being superseded is derived at read time, never stored, because storing it would edit a frozen row. No capacity column, no mean, ever (D-11, §6, §3.2).';
COMMENT ON COLUMN public.reality_check_issues.tick_slug IS
  'The citable tick id: ISO week of the data-clock night (2026-W38), with -r<revision> on a superseding tick. Stable across a republish — PR-7''s public URL is built from it.';
COMMENT ON COLUMN public.reality_check_issues.claims IS
  'refinery_rc_walkforward() read AT PUBLICATION and frozen, so a cited tick keeps the claims line it published. The accessor also returns the live monitor beside it, labelled with its own as-of; the content hash covers the frozen block only.';
COMMENT ON COLUMN public.reality_check_issues.content_hash IS
  'sha256 over the run row, every verdict row ordered by cluster_key, and the frozen claims block — each row projected onto digest_keys. reality_check_tick() recomputes it on every read and reports hash_matches: a published tick that is not byte-identical on re-read is a defect, not a new number.';
COMMENT ON COLUMN public.reality_check_issues.digest_keys IS
  'The column names the content hash was taken over: {"run": [...], "verdicts": [...]}, read from the rows themselves at publication and frozen with the hash. Without it, one ALTER TABLE ... ADD COLUMN on reality_check_runs or reality_check_site_verdicts would make EVERY published tick report hash_matches = false, and the board would cry tampering over a schema change. A column dropped after publication still breaks the hash — that data really did go.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rci_asset_class') THEN
    ALTER TABLE public.reality_check_issues ADD CONSTRAINT rci_asset_class
      CHECK (asset_class = 'refinery');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rci_revision') THEN
    ALTER TABLE public.reality_check_issues ADD CONSTRAINT rci_revision
      CHECK (revision >= 1 AND (revision = 1) = (supersedes_run_id IS NULL)
             AND (supersedes_run_id IS NULL OR supersedes_run_id <> run_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rci_slug_shape') THEN
    ALTER TABLE public.reality_check_issues ADD CONSTRAINT rci_slug_shape
      CHECK (tick_slug ~ '^[0-9]{4}-W[0-9]{2}(-r[0-9]+)?$'
             AND (revision = 1) = (tick_slug !~ '-r[0-9]+$'));
  END IF;
  -- D-6: the windows are the run's, re-asserted on the published object
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rci_window_arithmetic') THEN
    ALTER TABLE public.reality_check_issues ADD CONSTRAINT rci_window_arithmetic
      CHECK (window_end = data_clock_night
             AND window_end > window_start
             AND baseline_end = window_start - 1
             AND baseline_end > baseline_start);
  END IF;
  -- §2.2: the funnel narrows, term by term, and publishes its denominators
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rci_funnel_monotone') THEN
    ALTER TABLE public.reality_check_issues ADD CONSTRAINT rci_funnel_monotone
      CHECK (watched_complexes >= observed_complexes
             AND observed_complexes >= heat_observable_complexes
             AND heat_observable_complexes >= thermally_dark_complexes
             AND thermally_dark_complexes = refuted_complexes + lead_complexes + withheld_complexes
             AND thermally_dark_rows = refuted_rows + lead_rows + withheld_rows
             AND watched_rows >= observed_rows AND observed_rows >= heat_observable_rows
             AND heat_observable_rows >= thermally_dark_rows
             AND refuted_complexes >= 0 AND lead_complexes >= 0 AND withheld_complexes >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rci_hash_shape') THEN
    ALTER TABLE public.reality_check_issues ADD CONSTRAINT rci_hash_shape
      CHECK (content_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rci_claims_sane') THEN
    ALTER TABLE public.reality_check_issues ADD CONSTRAINT rci_claims_sane
      CHECK (claims_issued IS NULL OR claims_issued >= 0);
  END IF;
  -- The counts are an object over the D-2 vocabulary, with no state missing
  -- and no ninth state invented. Asserted WITHOUT a sub-SELECT, because a
  -- CHECK constraint may not contain one: PostgreSQL refuses the whole
  -- statement with 0A000 "cannot use subquery in check constraint", and in
  -- a one-transaction migration that aborts the entire file.
  --   ?&  — all eight keys are present
  --   - ARRAY[…] = '{}' — removing those eight leaves nothing, so there is
  --                       no ninth key
  -- Together those two are exactly "these eight keys and no others", the
  -- same assertion the count + eight ? tests made. The CASE is not
  -- decoration: AND is not guaranteed to short-circuit, and `jsonb - text[]`
  -- raises on a scalar, so the object test has to gate the other two rather
  -- than sit beside them.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rci_counts_vocabulary') THEN
    ALTER TABLE public.reality_check_issues ADD CONSTRAINT rci_counts_vocabulary
      CHECK (CASE WHEN jsonb_typeof(counts_by_verdict) = 'object' THEN
                    counts_by_verdict ?& ARRAY['STEADY','LIGHT_DOWN_ONLY','REFUTED','LEAD',
                                               'VOID_NOT_OBSERVED','VOID_INSUFFICIENT_NIGHTS',
                                               'VOID_BASELINE_UNSTABLE','VOID_HEAT_NOT_OBSERVABLE']::text[]
                AND counts_by_verdict -  ARRAY['STEADY','LIGHT_DOWN_ONLY','REFUTED','LEAD',
                                               'VOID_NOT_OBSERVED','VOID_INSUFFICIENT_NIGHTS',
                                               'VOID_BASELINE_UNSTABLE','VOID_HEAT_NOT_OBSERVABLE']::text[]
                    = '{}'::jsonb
                  ELSE false END);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reality_check_issues_clock_idx
  ON public.reality_check_issues (asset_class, data_clock_night DESC, revision DESC);
CREATE INDEX IF NOT EXISTS reality_check_issues_supersedes_idx
  ON public.reality_check_issues (supersedes_run_id) WHERE supersedes_run_id IS NOT NULL;

ALTER TABLE public.reality_check_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reality_check_issues FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.reality_check_issues TO service_role;

-- ─── 2 · The content hash ──────────────────────────────────────────────
-- Over the ENTIRE run row and EVERY verdict row, ordered by cluster_key,
-- plus the claims block being published. No exclusion list: the immutability
-- triggers below freeze all of it, so hashing everything is both stronger and
-- impossible to get subtly wrong. jsonb serialises its keys in a canonical
-- order, so ::text is deterministic.
--
-- WHAT p_keys IS FOR. The triggers freeze the ROWS; they cannot freeze the
-- TABLE. `ALTER TABLE reality_check_runs ADD COLUMN …` in some later
-- migration changes to_jsonb() of every existing row, and a digest taken over
-- the whole row would then stop matching for every tick ever published — the
-- board would read "DOES NOT MATCH — report this" on a schema change that
-- altered no measurement. So each row is projected onto the column names the
-- tick published with, stored beside the hash in digest_keys. This is not an
-- exclusion list: it is the set that existed at publication, read from the
-- rows themselves. A column added later is outside the tick; a column removed
-- later still breaks the hash, because that data really is gone.
--
-- p_keys NULL means "every key these rows have right now", which is what
-- publication passes (and then stores). Passing the stored keys and passing
-- NULL give the same hash on an unchanged schema.
DROP FUNCTION IF EXISTS public.reality_check_issue_digest(bigint, jsonb, integer);
CREATE OR REPLACE FUNCTION public.reality_check_issue_digest(
  p_run_id        bigint,
  p_claims        jsonb,
  p_claims_issued integer,
  p_keys          jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
SELECT encode(sha256(convert_to(jsonb_build_object(
         'digest_version', 1,
         'run',            (SELECT CASE
                                     WHEN p_keys ? 'run' THEN
                                       (SELECT jsonb_object_agg(k, coalesce(to_jsonb(r) -> k, 'null'::jsonb))
                                          FROM jsonb_array_elements_text(p_keys -> 'run') k)
                                     ELSE to_jsonb(r)
                                   END
                              FROM public.reality_check_runs r WHERE r.id = p_run_id),
         'verdicts',       coalesce((SELECT jsonb_agg(CASE
                                                        WHEN p_keys ? 'verdicts' THEN
                                                          (SELECT jsonb_object_agg(k, coalesce(to_jsonb(v) -> k, 'null'::jsonb))
                                                             FROM jsonb_array_elements_text(p_keys -> 'verdicts') k)
                                                        ELSE to_jsonb(v)
                                                      END ORDER BY v.cluster_key)
                                       FROM public.reality_check_site_verdicts v
                                      WHERE v.run_id = p_run_id), '[]'::jsonb),
         'claims',         coalesce(p_claims, 'null'::jsonb),
         'claims_issued',  to_jsonb(p_claims_issued)
       )::text, 'UTF8')), 'hex');
$function$;

COMMENT ON FUNCTION public.reality_check_issue_digest(bigint, jsonb, integer, jsonb) IS
  'Reality Check PR-6 (mig 171). The tick''s content hash: sha256 over the run row, every verdict row ordered by cluster_key, and the claims block, each row projected onto p_keys (the column names the tick published with, NULL = whatever the rows have now). Pure in its arguments, so publication and verification compute it the same way, and a column added to either table after publication cannot turn a frozen tick into a false alarm. Service role only.';

REVOKE EXECUTE ON FUNCTION public.reality_check_issue_digest(bigint, jsonb, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reality_check_issue_digest(bigint, jsonb, integer, jsonb) TO service_role;

-- ─── 3 · Publication ───────────────────────────────────────────────────
-- Publishes every COMPLETE run that has no issue yet, oldest first (or one
-- named run). Idempotent: a run that is already published is reported as
-- 'already', never re-hashed and never touched. The funnel terms are counted
-- here, from the verdicts, with exactly the semantics of funnelOf() in
-- apps/web/lib/reality-check/classify.ts — the guard script asserts the two
-- agree on live rows.
CREATE OR REPLACE FUNCTION public.reality_check_publish_tick(p_run_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  r          record;
  v_claims   jsonb;
  v_rev      integer;
  v_slug     text;
  v_hash     text;
  v_keys     jsonb;
  v_done     jsonb := '[]'::jsonb;
  v_already  jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT run.*
      FROM public.reality_check_runs run
     WHERE run.status = 'complete'
       AND (p_run_id IS NULL OR run.id = p_run_id)
     ORDER BY run.data_clock_night, run.id
  LOOP
    IF EXISTS (SELECT 1 FROM public.reality_check_issues i WHERE i.run_id = r.id) THEN
      v_already := v_already || to_jsonb(r.id);
      CONTINUE;
    END IF;

    -- revision: how many ticks this data-clock night has already published
    SELECT count(*) + 1 INTO v_rev
      FROM public.reality_check_issues i
     WHERE i.asset_class = r.asset_class AND i.data_clock_night = r.data_clock_night;
    v_slug := to_char(r.data_clock_night, 'IYYY-"W"IW')
              || CASE WHEN v_rev > 1 THEN '-r' || v_rev ELSE '' END;

    -- the claims line as at publication (D-7). refinery_rc_walkforward() is
    -- the monitor, recomputed on read; what is frozen here is the reading the
    -- tick published, so a cited tick keeps its own figures.
    BEGIN
      v_claims := public.refinery_rc_walkforward();
    EXCEPTION WHEN OTHERS THEN
      -- the monitor must never stop a tick being published; the failure is
      -- recorded in the frozen block instead of being swallowed
      v_claims := jsonb_build_object('error', SQLERRM, 'as_of', now(), 'families', '{}'::jsonb);
    END;

    -- the column names this tick is hashed over, read from the rows
    -- themselves and frozen beside the hash (see the digest's header)
    SELECT jsonb_build_object(
             'run', (SELECT jsonb_agg(k ORDER BY k)
                       FROM jsonb_object_keys((SELECT to_jsonb(x)
                                                 FROM public.reality_check_runs x
                                                WHERE x.id = r.id)) k),
             'verdicts', coalesce((SELECT jsonb_agg(k ORDER BY k)
                                     FROM jsonb_object_keys((SELECT to_jsonb(y)
                                                               FROM public.reality_check_site_verdicts y
                                                              WHERE y.run_id = r.id
                                                              ORDER BY y.cluster_key LIMIT 1)) k),
                                  '[]'::jsonb))
      INTO v_keys;
    v_hash := public.reality_check_issue_digest(r.id, v_claims, r.claims_issued, v_keys);

    INSERT INTO public.reality_check_issues (
      run_id, tick_slug, revision, asset_class, data_clock_night,
      window_start, window_end, baseline_start, baseline_end, supersedes_run_id,
      parameters,
      watched_complexes, watched_rows, observed_complexes, observed_rows,
      heat_observable_complexes, heat_observable_rows,
      thermally_dark_complexes, thermally_dark_rows,
      refuted_complexes, refuted_rows, lead_complexes, lead_rows,
      withheld_complexes, withheld_rows,
      counts_by_verdict, robustness, claims_issued, claims, content_hash, digest_keys)
    SELECT
      r.id, v_slug, v_rev, r.asset_class, r.data_clock_night,
      r.window_start, r.window_end, r.baseline_start, r.baseline_end, r.supersedes_run_id,
      jsonb_build_object(
        'statistic', r.statistic,
        'light_column', r.light_column,
        'robustness_column', r.robustness_column,
        'robustness_min_px_hq', r.robustness_min_px_hq,
        'clear_night_rule', r.clear_night_rule,
        'census_usable_ratio', r.census_usable_ratio,
        'light_down_ratio', r.light_down_ratio,
        'heat_down_ratio', r.heat_down_ratio,
        'heat_observable_floor', r.heat_observable_floor,
        'heat_rate_rule', r.heat_rate_rule,
        'min_baseline_nights', r.min_baseline_nights,
        'min_window_nights', r.min_window_nights,
        'ks_min_baseline_nights', r.ks_min_baseline_nights,
        'ks_alpha', r.ks_alpha,
        'ks_split_rule', r.ks_split_rule,
        'complex_rule', r.complex_rule,
        'complex_linkage_m', r.complex_linkage_m,
        'complex_rematch_m', r.complex_rematch_m,
        'window_nights', r.window_nights,
        'baseline_nights', r.baseline_nights,
        'classifier_version', r.classifier_version,
        'recall', 'not measured'),
      f.watched_c, f.watched_r, f.observed_c, f.observed_r,
      f.hobs_c, f.hobs_r, f.dark_c, f.dark_r,
      f.ref_c, f.ref_r, f.lead_c, f.lead_r, f.wh_c, f.wh_r,
      f.counts, f.robustness, r.claims_issued, v_claims, v_hash, v_keys
    FROM (
      SELECT
        count(*)::int                                                                   AS watched_c,
        coalesce(sum(v.member_count), 0)::int                                           AS watched_r,
        count(*) FILTER (WHERE v.coverage_state = 'OBSERVED')::int                      AS observed_c,
        coalesce(sum(v.member_count) FILTER (WHERE v.coverage_state = 'OBSERVED'), 0)::int AS observed_r,
        count(*) FILTER (WHERE v.coverage_state = 'OBSERVED'
                           AND v.heat_state IS DISTINCT FROM 'HEAT_NOT_OBSERVABLE')::int AS hobs_c,
        coalesce(sum(v.member_count) FILTER (WHERE v.coverage_state = 'OBSERVED'
                           AND v.heat_state IS DISTINCT FROM 'HEAT_NOT_OBSERVABLE'), 0)::int AS hobs_r,
        count(*) FILTER (WHERE v.coverage_state = 'OBSERVED'
                           AND v.heat_state = 'HEAT_DOWN')::int                          AS dark_c,
        coalesce(sum(v.member_count) FILTER (WHERE v.coverage_state = 'OBSERVED'
                           AND v.heat_state = 'HEAT_DOWN'), 0)::int                      AS dark_r,
        count(*) FILTER (WHERE v.verdict = 'REFUTED')::int                               AS ref_c,
        coalesce(sum(v.member_count) FILTER (WHERE v.verdict = 'REFUTED'), 0)::int       AS ref_r,
        count(*) FILTER (WHERE v.verdict = 'LEAD')::int                                  AS lead_c,
        coalesce(sum(v.member_count) FILTER (WHERE v.verdict = 'LEAD'), 0)::int          AS lead_r,
        count(*) FILTER (WHERE v.coverage_state = 'OBSERVED' AND v.heat_state = 'HEAT_DOWN'
                           AND v.verdict LIKE 'VOID\_%')::int                            AS wh_c,
        coalesce(sum(v.member_count) FILTER (WHERE v.coverage_state = 'OBSERVED'
                           AND v.heat_state = 'HEAT_DOWN'
                           AND v.verdict LIKE 'VOID\_%'), 0)::int                        AS wh_r,
        (SELECT jsonb_object_agg(k, coalesce(c.n, 0))
           FROM unnest(ARRAY['STEADY','LIGHT_DOWN_ONLY','REFUTED','LEAD','VOID_NOT_OBSERVED',
                             'VOID_INSUFFICIENT_NIGHTS','VOID_BASELINE_UNSTABLE',
                             'VOID_HEAT_NOT_OBSERVABLE']) k
           LEFT JOIN (SELECT verdict, count(*)::int AS n
                        FROM public.reality_check_site_verdicts
                       WHERE run_id = r.id GROUP BY verdict) c ON c.verdict = k)         AS counts,
        -- D-13: the same funnel on the stricter 3x3 retrieval, published
        -- beside the primary one, plus every row whose verdict flips
        jsonb_build_object(
          'column', r.robustness_column,
          'min_px_hq', r.robustness_min_px_hq,
          'observed', count(*) FILTER (WHERE v.r3_baseline_nights >= r.min_baseline_nights
                                         AND v.r3_window_nights >= r.min_window_nights)::int,
          'heat_observable', count(*) FILTER (WHERE v.r3_baseline_nights >= r.min_baseline_nights
                                         AND v.r3_window_nights >= r.min_window_nights
                                         AND v.heat_state IS DISTINCT FROM 'HEAT_NOT_OBSERVABLE')::int,
          'thermally_dark', count(*) FILTER (WHERE v.r3_baseline_nights >= r.min_baseline_nights
                                         AND v.r3_window_nights >= r.min_window_nights
                                         AND v.heat_state = 'HEAT_DOWN')::int,
          'lead', count(*) FILTER (WHERE v.r3_baseline_nights >= r.min_baseline_nights
                                         AND v.r3_window_nights >= r.min_window_nights
                                         AND v.heat_state = 'HEAT_DOWN'
                                         AND v.r3_window_median < r.light_down_ratio * v.r3_baseline_median)::int,
          'refuted', count(*) FILTER (WHERE v.r3_baseline_nights >= r.min_baseline_nights
                                         AND v.r3_window_nights >= r.min_window_nights
                                         AND v.heat_state = 'HEAT_DOWN'
                                         AND NOT coalesce(v.r3_window_median < r.light_down_ratio * v.r3_baseline_median, false))::int,
          'not_robust', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                           'cluster_key', x.cluster_key,
                                           'verdict', x.verdict,
                                           'robustness_verdict', x.robustness_verdict)
                                           ORDER BY x.cluster_key)
                                    FROM public.reality_check_site_verdicts x
                                   WHERE x.run_id = r.id AND x.robust_to_retrieval IS FALSE), '[]'::jsonb)
        )                                                                                AS robustness
      FROM public.reality_check_site_verdicts v
     WHERE v.run_id = r.id
    ) f;

    v_done := v_done || jsonb_build_object('run_id', r.id, 'tick', v_slug,
                                           'revision', v_rev, 'content_hash', v_hash);
  END LOOP;

  RETURN jsonb_build_object('published', v_done, 'already_published', v_already, 'at', now());
END;
$function$;

COMMENT ON FUNCTION public.reality_check_publish_tick(bigint) IS
  'Reality Check PR-6 (mig 171). Publishes every complete, unpublished tick (or one named run) as a reality_check_issues row: funnel terms by complex with facility rows, the pinned parameter block, counts by verdict, the 3x3 robustness funnel, the claims line frozen at publication, and the content hash. Idempotent and self-healing — a tick that failed to publish yesterday publishes on the next cron run. Publication is what freezes the tick. Service role only.';

REVOKE EXECUTE ON FUNCTION public.reality_check_publish_tick(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reality_check_publish_tick(bigint) TO service_role;

-- ─── 4 · Frozen ticks: the immutability triggers ───────────────────────
-- §3.3: "A cited board must never silently change; a late-arriving night
-- produces a superseding tick, never an edit."
--
-- Published is the switch. Before an issue row exists the tick is still being
-- written (running -> complete -> claims_issued); the moment it exists, the
-- run, its verdicts and the issue are read-only for EVERY role, service_role
-- included. There is deliberately no bypass: a correction is a new tick.
CREATE OR REPLACE FUNCTION public.reality_check_refuse_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_run  bigint;
  v_slug text;
BEGIN
  -- NEW is unassigned on DELETE and OLD on INSERT, so each is read only in
  -- the branch where the trigger actually has it.
  IF TG_TABLE_NAME = 'reality_check_issues' THEN
    RAISE EXCEPTION
      'reality_check_issues is append-only: tick % (run %) is published and frozen. A correction is a NEW tick that supersedes it (build prompt 3.3), never an edit.',
      OLD.tick_slug, OLD.run_id
      USING ERRCODE = 'restrict_violation';
  ELSIF TG_TABLE_NAME = 'reality_check_runs' THEN
    v_run := OLD.id;                     -- UPDATE / DELETE only
  ELSIF TG_OP = 'INSERT' THEN
    v_run := NEW.run_id;                 -- a verdict added to a published tick
  ELSE
    v_run := OLD.run_id;                 -- a verdict updated or deleted
  END IF;

  SELECT i.tick_slug INTO v_slug FROM public.reality_check_issues i WHERE i.run_id = v_run;
  IF v_slug IS NOT NULL THEN
    RAISE EXCEPTION
      '% on % is refused: run % is published as tick % and frozen. A late night publishes a superseding tick (supersedes_run_id), never an edit (build prompt 3.3).',
      TG_OP, TG_TABLE_NAME, v_run, v_slug
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reality_check_refuse_mutation() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reality_check_refuse_mutation() IS
  'Reality Check PR-6 (mig 171). Refuses any UPDATE or DELETE against a published tick — its run, its verdicts and its issue — and any INSERT of a verdict into one. Fires for every role including service_role: a published tick is frozen, and a correction is a new superseding tick.';

DROP TRIGGER IF EXISTS reality_check_runs_frozen     ON public.reality_check_runs;
DROP TRIGGER IF EXISTS reality_check_verdicts_frozen ON public.reality_check_site_verdicts;
DROP TRIGGER IF EXISTS reality_check_verdicts_sealed ON public.reality_check_site_verdicts;
DROP TRIGGER IF EXISTS reality_check_issues_frozen   ON public.reality_check_issues;

CREATE TRIGGER reality_check_runs_frozen
  BEFORE UPDATE OR DELETE ON public.reality_check_runs
  FOR EACH ROW EXECUTE FUNCTION public.reality_check_refuse_mutation();

CREATE TRIGGER reality_check_verdicts_frozen
  BEFORE UPDATE OR DELETE ON public.reality_check_site_verdicts
  FOR EACH ROW EXECUTE FUNCTION public.reality_check_refuse_mutation();

-- a row may not be ADDED to a published tick either, or the funnel the issue
-- froze would stop matching the verdicts behind it
CREATE TRIGGER reality_check_verdicts_sealed
  BEFORE INSERT ON public.reality_check_site_verdicts
  FOR EACH ROW EXECUTE FUNCTION public.reality_check_refuse_mutation();

CREATE TRIGGER reality_check_issues_frozen
  BEFORE UPDATE OR DELETE ON public.reality_check_issues
  FOR EACH ROW EXECUTE FUNCTION public.reality_check_refuse_mutation();

-- TRUNCATE is a DELETE path that no FOR EACH ROW trigger sees. service_role
-- holds TRUNCATE on reality_check_runs and reality_check_site_verdicts (and
-- the owner holds it on all three), so without this a single statement would
-- empty a published tick's verdicts, and the freeze above would never fire.
-- Statement-level, and unconditional once anything is published: a published
-- tick is corrected by a superseding tick, never by emptying the table.
CREATE OR REPLACE FUNCTION public.reality_check_refuse_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.reality_check_issues;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'TRUNCATE on % is refused: % published tick(s) are frozen, and TRUNCATE is the one delete path a row trigger never sees. A correction is a NEW tick that supersedes the old one (build prompt 3.3).',
      TG_TABLE_NAME, v_n
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reality_check_refuse_truncate() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reality_check_refuse_truncate() IS
  'Reality Check PR-6 (mig 171). Refuses TRUNCATE on reality_check_runs, reality_check_site_verdicts and reality_check_issues once any tick is published. TRUNCATE bypasses FOR EACH ROW triggers, so without this the frozen-tick rule had a one-statement hole for every role that holds the privilege, service_role included.';

DROP TRIGGER IF EXISTS reality_check_runs_no_truncate     ON public.reality_check_runs;
DROP TRIGGER IF EXISTS reality_check_verdicts_no_truncate ON public.reality_check_site_verdicts;
DROP TRIGGER IF EXISTS reality_check_issues_no_truncate   ON public.reality_check_issues;

CREATE TRIGGER reality_check_runs_no_truncate
  BEFORE TRUNCATE ON public.reality_check_runs
  FOR EACH STATEMENT EXECUTE FUNCTION public.reality_check_refuse_truncate();
CREATE TRIGGER reality_check_verdicts_no_truncate
  BEFORE TRUNCATE ON public.reality_check_site_verdicts
  FOR EACH STATEMENT EXECUTE FUNCTION public.reality_check_refuse_truncate();
CREATE TRIGGER reality_check_issues_no_truncate
  BEFORE TRUNCATE ON public.reality_check_issues
  FOR EACH STATEMENT EXECUTE FUNCTION public.reality_check_refuse_truncate();

-- ─── 5 · The ONE read accessor ─────────────────────────────────────────
-- Everything the board renders comes from here, with the §5 field mask
-- applied inside the function. The BRIEFS issue (PR-7) and
-- query_reality_check (PR-8) call the same function with a different tier.
-- It classifies nothing: no threshold is applied to a measurement here, and
-- no verdict is derived — the verdicts are read as the tick wrote them.
--
--   p_tier        'public' | 'member' | 'pro'   (anything else -> 'public')
--   p_tick        a tick_slug; NULL = the current (newest, non-superseded) tick
--   p_cluster_key a complex to drill into (pro only)
--   p_asset       asset class; only 'refinery' has a detector today
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
  v_tier    text := CASE lower(coalesce(p_tier, '')) WHEN 'pro' THEN 'pro'
                                                     WHEN 'member' THEN 'member'
                                                     ELSE 'public' END;
  i         public.reality_check_issues%ROWTYPE;
  r         public.reality_check_runs%ROWTYPE;
  v_out     jsonb;
  v_rows    jsonb;
  v_arch    jsonb;
  v_sup_by  jsonb;
  v_sup     text;
  v_hash    text;
  v_live    jsonb;
  v_runs    integer;
  v_done    integer;
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

  -- ── integrity: recompute the hash over the frozen rows ──────────────
  -- projected onto the columns the tick published with, so a column added to
  -- either table by a later migration cannot turn a frozen tick into a false
  -- alarm, while a column removed still breaks the hash
  v_hash := public.reality_check_issue_digest(i.run_id, i.claims, i.claims_issued, i.digest_keys);

  -- ── the live monitor, beside the frozen claims line (D-7) ───────────
  BEGIN
    v_live := public.refinery_rc_walkforward();
  EXCEPTION WHEN OTHERS THEN
    v_live := jsonb_build_object('error', SQLERRM);
  END;

  -- ── the board rows, masked (§5) ─────────────────────────────────────
  WITH v AS (
    SELECT * FROM public.reality_check_site_verdicts WHERE run_id = i.run_id
  ), site AS (
    SELECT v.cluster_key,
           (array_agg(rf.refinery_name ORDER BY (rf.refinery_name IS NULL), rf.refinery_name, rf.id))[1] AS site_name,
           array_agg(coalesce(rf.refinery_name, '(unnamed OSM site ' || rf.id || ')') ORDER BY rf.id)    AS member_names,
           (array_agg(rf.iso_country ORDER BY (rf.iso_country IS NULL), rf.id))[1] AS iso_country,
           (array_agg(rf.country     ORDER BY (rf.country     IS NULL), rf.id))[1] AS country,
           (array_agg(rf.city        ORDER BY (rf.city        IS NULL), rf.id))[1] AS city,
           (array_agg(rf.us_state    ORDER BY (rf.us_state    IS NULL), rf.id))[1] AS us_state,
           count(DISTINCT rf.iso_country)::int                                     AS iso_countries
      FROM v JOIN public.refineries rf ON rf.id = ANY (v.members)
     GROUP BY v.cluster_key
  )
  SELECT jsonb_agg(payload ORDER BY ord, key) INTO v_rows
    FROM (
      SELECT
        -- the refutation cell is the hero: refuted rows sort first, the lead
        -- never leads the board (§3.3)
        CASE v.verdict WHEN 'REFUTED' THEN 0 WHEN 'LEAD' THEN 1 WHEN 'LIGHT_DOWN_ONLY' THEN 2
                       WHEN 'STEADY' THEN 3 ELSE 4 END AS ord,
        v.cluster_key AS key,
        jsonb_build_object(
          'cluster_key', v.cluster_key,
          'site_name', CASE WHEN v.verdict = 'LEAD' AND v_tier <> 'pro' THEN NULL
                            ELSE coalesce(s.site_name, '(unnamed complex ' || v.cluster_key || ')') END,
          'name_masked', (v.verdict = 'LEAD' AND v_tier <> 'pro'),
          'member_count', v.member_count,
          'member_names', CASE WHEN v_tier = 'pro' THEN to_jsonb(s.member_names) ELSE NULL END,
          'members', CASE WHEN v_tier = 'pro' THEN to_jsonb(v.members) ELSE NULL END,
          'location', CASE WHEN v.verdict = 'LEAD' AND v_tier <> 'pro' THEN NULL ELSE jsonb_build_object(
              'iso_country', s.iso_country,
              'country', s.country,
              'city', s.city,
              'us_state', s.us_state,
              'multi_country', s.iso_countries > 1,
              'latitude', round(c.centroid_lat::numeric, 4),
              'longitude', round(c.centroid_lon::numeric, 4),
              'note', 'ISO country and city are read from the refinery registry (migration 158) on each request, so a re-geocoded site changes its label here even on a frozen tick; the coordinates are the complex centroid, written once at mint and never updated. No other place name is invented, and no measurement, threshold or verdict is outside the content hash.') END,
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
      LEFT JOIN site s ON s.cluster_key = v.cluster_key
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
    'counts_by_verdict', i.counts_by_verdict,
    'robustness', i.robustness,
    'claims', jsonb_build_object(
      'issued_on_this_tick', i.claims_issued,
      'at_publication', i.claims,
      'live', v_live),
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
      -- say exactly what the hash does and does not cover, so "verified on
      -- read" is not read as more than it is
      'covers', 'The run row, every verdict row and the claims block as published — every measurement, threshold, window and verdict on this board.',
      'not_covered', 'Site names, city, country and US state are read from the refinery registry on each request, not frozen with the tick: if a site is renamed or re-geocoded in the registry, the label on a cited tick follows it. The complex centroid IS frozen — it is written once at mint and never updated. No measurement, threshold or verdict is outside the hash.'),
    'supersession', jsonb_build_object(
      'current', v_sup_by IS NULL,
      'superseded_by', v_sup_by,
      'supersedes', v_sup),
    'archive', coalesce(v_arch, '[]'::jsonb),
    'rows', coalesce(v_rows, '[]'::jsonb),
    'mask', jsonb_build_object(
      'tier', v_tier,
      'lead_names', CASE WHEN v_tier = 'pro' THEN 'visible' ELSE 'count only' END,
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
    v_out := v_out || jsonb_build_object('drilldown', jsonb_build_object(
      'cluster_key', p_cluster_key,
      'withheld', true,
      'reason', 'The night-by-night sensor strips are a Pro surface (build prompt 5, D-12).'));
  END IF;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.reality_check_tick(text, text, text, text) IS
  'Reality Check PR-6 (mig 171). THE read accessor: the board, the BRIEFS issue (PR-7) and query_reality_check (PR-8) all call this and nothing else, so the three can never publish different numbers for one tick (5.3). Returns the published tick — funnel terms by complex, parameters, windows, counts by verdict, the 3x3 robustness funnel, the claims line frozen at publication beside the live monitor, the coverage strip, the content hash recomputed, the supersession links, the archive and the masked rows — with the field mask of section 5 applied inside the function (lead names and the drill-down are Pro; public and member see the current tick only). An honest empty object when no tick is published. Classifies nothing. Service role only.';

REVOKE EXECUTE ON FUNCTION public.reality_check_tick(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reality_check_tick(text, text, text, text) TO service_role;

-- ─── 6 · The decision on the record (D-5 / R-2) ────────────────────────
INSERT INTO public.ledger_change_log (at, pr, note)
SELECT now(), '#PR6 · mig 171',
       'Reality Check surface (mig 171): a tick becomes a PUBLISHED OBJECT. reality_check_issues freezes the five funnel terms by complex (with facility rows), the pinned parameter block, the counts by verdict, the 3x3 robustness funnel, the claims line as at publication and a sha256 content hash over the run and every verdict row, each row projected onto the column names the tick published with (digest_keys) so that a later ALTER TABLE cannot turn every frozen tick into a false tampering alarm. From the moment an issue row exists the run, its verdicts and the issue refuse UPDATE, DELETE and TRUNCATE for every role including service_role, and no verdict may be inserted into it: a late night publishes a SUPERSEDING tick (revision 2 of the same ISO week, …-r2) and the old tick stays readable and citable. Which tick is current is derived at read time, never stored, because storing it would edit a frozen row. reality_check_tick() is the single accessor the board, the BRIEFS issue (PR-7) and query_reality_check (PR-8) read, with the section-5 field mask inside it (lead names and the drill-down are Pro, D-12). No parameter, threshold, column or window changed: PR-6 publishes what PR-5 computes. No capacity figure anywhere — every row carries the constant ''Capacity not established'' cell with its reason until CAP-3 (D-11, section 6). Recall is not measured, and says so on every refinery figure (D-10).'
 WHERE NOT EXISTS (SELECT 1 FROM public.ledger_change_log WHERE note LIKE 'Reality Check surface (mig 171)%');

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only. Paste these rows back.
-- ═══════════════════════════════════════════════════════════════════════

-- V1 · objects exist (expect every present = true, 8 rows)
SELECT 'table reality_check_issues' AS object, to_regclass('public.reality_check_issues') IS NOT NULL AS present
UNION ALL SELECT 'column reality_check_issues.digest_keys', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reality_check_issues' AND column_name = 'digest_keys' AND is_nullable = 'NO')
UNION ALL SELECT 'fn reality_check_issue_digest(4 args)', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'reality_check_issue_digest' AND p.pronargs = 4)
UNION ALL SELECT 'fn reality_check_publish_tick',  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'reality_check_publish_tick')
UNION ALL SELECT 'fn reality_check_tick',          EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'reality_check_tick')
UNION ALL SELECT 'fn reality_check_refuse_mutation', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'reality_check_refuse_mutation')
UNION ALL SELECT 'fn reality_check_refuse_truncate', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'reality_check_refuse_truncate')
UNION ALL SELECT 'ledger_change_log row',          EXISTS (SELECT 1 FROM public.ledger_change_log WHERE note LIKE 'Reality Check surface (mig 171)%');

-- V2 · the seven immutability triggers — four per-row, three per-statement
--      against TRUNCATE, the one delete path a row trigger never sees
--      (expect exactly 7 rows)
SELECT c.relname AS on_table, t.tgname, pg_get_triggerdef(t.oid) AS def
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal
   AND t.tgname IN ('reality_check_runs_frozen', 'reality_check_verdicts_frozen',
                    'reality_check_verdicts_sealed', 'reality_check_issues_frozen',
                    'reality_check_runs_no_truncate', 'reality_check_verdicts_no_truncate',
                    'reality_check_issues_no_truncate')
 ORDER BY 1, 2;

-- V3 · every named CHECK on the issues table (expect 8 rows)
SELECT conname FROM pg_constraint
 WHERE conrelid = 'public.reality_check_issues'::regclass AND contype = 'c'
 ORDER BY 1;

-- V4 · grants: service_role only, on the table and all three functions
--      (expect anon = false and authenticated = false on every row, 8 rows)
SELECT 'table reality_check_issues' AS object,
       has_table_privilege('anon', 'public.reality_check_issues', 'SELECT')          AS anon,
       has_table_privilege('authenticated', 'public.reality_check_issues', 'SELECT') AS authenticated,
       has_table_privilege('service_role', 'public.reality_check_issues', 'SELECT')  AS service_role
UNION ALL SELECT 'table reality_check_issues INSERT',
       has_table_privilege('anon', 'public.reality_check_issues', 'INSERT'),
       has_table_privilege('authenticated', 'public.reality_check_issues', 'INSERT'),
       has_table_privilege('service_role', 'public.reality_check_issues', 'INSERT')
UNION ALL SELECT 'table reality_check_issues UPDATE',
       has_table_privilege('anon', 'public.reality_check_issues', 'UPDATE'),
       has_table_privilege('authenticated', 'public.reality_check_issues', 'UPDATE'),
       has_table_privilege('service_role', 'public.reality_check_issues', 'UPDATE')
UNION ALL SELECT 'fn reality_check_tick',
       has_function_privilege('anon', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE'),
       has_function_privilege('service_role', 'public.reality_check_tick(text,text,text,text)', 'EXECUTE')
UNION ALL SELECT 'fn reality_check_publish_tick',
       has_function_privilege('anon', 'public.reality_check_publish_tick(bigint)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.reality_check_publish_tick(bigint)', 'EXECUTE'),
       has_function_privilege('service_role', 'public.reality_check_publish_tick(bigint)', 'EXECUTE')
UNION ALL SELECT 'fn reality_check_issue_digest',
       has_function_privilege('anon', 'public.reality_check_issue_digest(bigint,jsonb,integer,jsonb)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.reality_check_issue_digest(bigint,jsonb,integer,jsonb)', 'EXECUTE'),
       has_function_privilege('service_role', 'public.reality_check_issue_digest(bigint,jsonb,integer,jsonb)', 'EXECUTE')
UNION ALL SELECT 'table reality_check_runs UPDATE (still granted; the TRIGGER refuses published rows)',
       has_table_privilege('anon', 'public.reality_check_runs', 'UPDATE'),
       has_table_privilege('authenticated', 'public.reality_check_runs', 'UPDATE'),
       has_table_privilege('service_role', 'public.reality_check_runs', 'UPDATE')
UNION ALL SELECT 'table reality_check_site_verdicts SELECT',
       has_table_privilege('anon', 'public.reality_check_site_verdicts', 'SELECT'),
       has_table_privilege('authenticated', 'public.reality_check_site_verdicts', 'SELECT'),
       has_table_privilege('service_role', 'public.reality_check_site_verdicts', 'SELECT');

-- V5 · no capacity, mean or volume column anywhere on the RC objects
--      (expect forbidden_columns = 0)
SELECT count(*) AS forbidden_columns
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('reality_check_issues', 'reality_check_runs', 'reality_check_site_verdicts')
   AND (column_name ~* '(mean|avg|average|capacity|bpd|barrel|offline|volume)');

-- V6 · state of publication right now. Before the first tick (expected on
--      apply day) this reads 0, 0, 0 and the accessor's empty state.
SELECT (SELECT count(*) FROM public.reality_check_runs)                                AS runs,
       (SELECT count(*) FROM public.reality_check_runs WHERE status = 'complete')       AS runs_complete,
       (SELECT count(*) FROM public.reality_check_issues)                               AS issues,
       public.reality_check_tick('pro')->>'published'                                   AS published,
       public.reality_check_tick('pro')->>'empty_reason'                                AS empty_reason;

-- V7 · after the first tick publishes (2026-09-21 ~10:22 UTC), re-run this:
--      expect published = true, hash_matches = true, current = true, and the
--      funnel reading 295 -> 230 -> 87 -> 10 -> 9 refuted + 0 lead + 1 withheld
SELECT t->>'tick'                                       AS tick,
       t->>'published'                                  AS published,
       t#>>'{integrity,hash_matches}'                   AS hash_matches,
       t#>>'{supersession,current}'                     AS current,
       t#>>'{funnel,watched,complexes}'                 AS watched,
       t#>>'{funnel,observed,complexes}'                AS observed,
       t#>>'{funnel,heat_observable,complexes}'         AS heat_observable,
       t#>>'{funnel,thermally_dark,complexes}'          AS thermally_dark,
       t#>>'{funnel,refuted,complexes}'                 AS refuted,
       t#>>'{funnel,lead,complexes}'                    AS lead,
       t#>>'{funnel,withheld,complexes}'                AS withheld,
       t#>>'{claims,issued_on_this_tick}'               AS claims_issued,
       jsonb_array_length(t->'rows')                    AS rows_returned
  FROM (SELECT public.reality_check_tick('pro') AS t) x;
