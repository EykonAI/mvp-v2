-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 161 · Reality Check runs + site verdicts + the classifier's
--             read surface  (Reality Check programme, PR-1; D-2, D-3, D-4,
--             D-6, D-8, D-14; guards 1, 3 and 4 of §3.2)
--
-- PURPOSE
-- The tick (PR-5, TypeScript, D-14) will write one reality_check_runs row
-- and one reality_check_site_verdicts row per complex. This migration
-- makes every recorded classifier defect unrepresentable BEFORE any tick
-- exists, so a wrong run fails at INSERT, not at review:
--
--   guard 1  means manufacture collapses  → the classifier reads
--            refinery_complex_light_nights, which exposes per-night MEDIANS
--            only; no avg( over radiance exists in the path, and the verdict
--            table has no mean column (CI gate: scripts/reality-check/
--            check-no-mean.mjs).
--   guard 3  a baseline spanning two regimes → ks_d / ks_p / ks_tested are
--            stored (computed by lib/intel/ks.ts, never a second KS) and a
--            CHECK forces VOID_BASELINE_UNSTABLE when the test ran and
--            failed (ks_p < 0.05).
--   guard 4  low baseline heat labelled "heat steady" → three-valued
--            heat_state; a CHECK forbids HEAT_STEADY at a baseline heat rate
--            <= 0.20 (the observability floor).
--   (guard 2, the night census, is migration 159; guard 5, the stable
--    complex key, is migration 160 — verdicts reference its keys by FK.)
--
-- VERDICT VOCABULARY (D-2, text + CHECK; the codebase has no enums):
--   STEADY, LIGHT_DOWN_ONLY, REFUTED, LEAD, VOID_NOT_OBSERVED,
--   VOID_INSUFFICIENT_NIGHTS, VOID_BASELINE_UNSTABLE, VOID_HEAT_NOT_OBSERVABLE
--
-- PINNED METHOD (§3.1, D-4, D-5, D-6) — persisted on every run row and
-- CHECK-pinned, so a parameter cannot change silently; changing one is a
-- migration plus a ledger_change_log row:
--   statistic median · light column radiance (clear nights carrying a
--   retrieval) · robustness radiance_3x3 with px_hq_3x3 >= 5 · clear rule
--   confident_clear · light-down and heat-down below 0.60 x baseline ·
--   heat-observable baseline heat rate above 0.20 · heat rate = days with
--   >= 1 FIRMS detection / FIRMS days · floors >= 5 baseline and >= 3 window
--   usable clear nights · KS only at >= 12 baseline nights, alpha 0.05 ·
--   windows inclusive: window = the 15 nights ending on the data-clock
--   night, baseline = the 31 nights before it · complex rule 5,000 m
--   single-linkage, RFC- keys re-matched within 2,500 m.
--   First tick: data clock 2026-09-01 → window 08-18..09-01, baseline
--   07-18..08-17.
--
-- SILENCE IS REPRESENTABLE: the night floors bind only non-VOID rows
-- (verdict LIKE 'VOID_%' OR (baseline_nights >= 5 AND window_nights >= 3)),
-- and ks_* are NULL-able for VOID rows.
--
-- No reality_check_issues and no immutability trigger here (PR-6). No
-- detector, no tick, no claim, no UI. No capacity column anywhere (§6).
--
-- Idempotent. No temp tables, no session state. Apply MANUALLY in the
-- Supabase SQL Editor, the whole file, AFTER 159 and 160, BEFORE merge.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1 · Runs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reality_check_runs (
  id                     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_class            text        NOT NULL DEFAULT 'refinery',
  started_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  status                 text        NOT NULL DEFAULT 'running',
  error                  text,
  -- the DATA clock, never the wall clock (Black Marble lags NASA ~9 days)
  data_clock_night       date        NOT NULL,
  window_start           date        NOT NULL,
  window_end             date        NOT NULL,
  baseline_start         date        NOT NULL,
  baseline_end           date        NOT NULL,
  window_nights          integer     NOT NULL DEFAULT 15,
  baseline_nights        integer     NOT NULL DEFAULT 31,
  statistic              text        NOT NULL DEFAULT 'median',
  light_column           text        NOT NULL DEFAULT 'radiance',
  robustness_column      text        NOT NULL DEFAULT 'radiance_3x3',
  robustness_min_px_hq   integer     NOT NULL DEFAULT 5,
  clear_night_rule       text        NOT NULL DEFAULT 'confident_clear',
  census_usable_ratio    numeric     NOT NULL DEFAULT 0.95,
  light_down_ratio       numeric     NOT NULL DEFAULT 0.60,
  heat_down_ratio        numeric     NOT NULL DEFAULT 0.60,
  heat_observable_floor  numeric     NOT NULL DEFAULT 0.20,
  heat_rate_rule         text        NOT NULL DEFAULT 'days_with_detection_over_firms_days',
  min_baseline_nights    integer     NOT NULL DEFAULT 5,
  min_window_nights      integer     NOT NULL DEFAULT 3,
  ks_min_baseline_nights integer     NOT NULL DEFAULT 12,
  ks_alpha               numeric     NOT NULL DEFAULT 0.05,
  complex_rule           text        NOT NULL DEFAULT 'single_linkage_geography_5000m_rfc_rematch_2500m_pooled_nightly_median',
  complex_linkage_m      integer     NOT NULL DEFAULT 5000,
  complex_rematch_m      integer     NOT NULL DEFAULT 2500,
  -- a late-arriving night produces a superseding tick, never an edit
  supersedes_run_id      bigint      REFERENCES public.reality_check_runs (id),
  classifier_version     text,
  complexes_in_scope     integer,
  verdicts_written       integer,
  duration_ms            integer
);

COMMENT ON TABLE public.reality_check_runs IS
  'Reality Check PR-1 (mig 161). One row per tick, written even when the tick finds nothing. Every method parameter is persisted and CHECK-pinned (D-5: no parameter changes silently). Windows are explicit inclusive dates derived from the data-clock night (D-6). supersedes_run_id links a superseding tick.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcr_asset_class') THEN
    ALTER TABLE public.reality_check_runs ADD CONSTRAINT rcr_asset_class
      CHECK (asset_class = 'refinery');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcr_status') THEN
    ALTER TABLE public.reality_check_runs ADD CONSTRAINT rcr_status
      CHECK (status IN ('running', 'complete', 'failed')
             AND ((status = 'running') = (completed_at IS NULL))
             AND (status <> 'failed' OR error IS NOT NULL));
  END IF;
  -- D-6: window_end = the data-clock night; window = 15 nights ending there;
  -- baseline = the 31 nights before the window. Inclusive of both endpoints.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcr_window_arithmetic') THEN
    ALTER TABLE public.reality_check_runs ADD CONSTRAINT rcr_window_arithmetic
      CHECK (window_end = data_clock_night
             AND window_end - window_start + 1 = window_nights
             AND baseline_end = window_start - 1
             AND baseline_end - baseline_start + 1 = baseline_nights);
  END IF;
  -- §3.1 / D-4 / D-5: the pinned method. A change is a migration + change-log row.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcr_method_pinned') THEN
    ALTER TABLE public.reality_check_runs ADD CONSTRAINT rcr_method_pinned
      CHECK (window_nights = 15 AND baseline_nights = 31
             AND statistic = 'median'
             AND light_column = 'radiance'
             AND robustness_column = 'radiance_3x3' AND robustness_min_px_hq = 5
             AND clear_night_rule = 'confident_clear'
             AND census_usable_ratio = 0.95
             AND light_down_ratio = 0.60 AND heat_down_ratio = 0.60
             AND heat_observable_floor = 0.20
             AND heat_rate_rule = 'days_with_detection_over_firms_days'
             AND min_baseline_nights = 5 AND min_window_nights = 3
             AND ks_min_baseline_nights = 12 AND ks_alpha = 0.05
             AND complex_rule = 'single_linkage_geography_5000m_rfc_rematch_2500m_pooled_nightly_median'
             AND complex_linkage_m = 5000 AND complex_rematch_m = 2500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcr_supersedes_other') THEN
    ALTER TABLE public.reality_check_runs ADD CONSTRAINT rcr_supersedes_other
      CHECK (supersedes_run_id IS NULL OR supersedes_run_id <> id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcr_counts_sane') THEN
    ALTER TABLE public.reality_check_runs ADD CONSTRAINT rcr_counts_sane
      CHECK (coalesce(complexes_in_scope, 0) >= 0 AND coalesce(verdicts_written, 0) >= 0
             AND coalesce(duration_ms, 0) >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reality_check_runs_clock_idx
  ON public.reality_check_runs (data_clock_night DESC, id DESC);

-- ─── 2 · Site verdicts: one per (run, complex) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.reality_check_site_verdicts (
  run_id                bigint  NOT NULL REFERENCES public.reality_check_runs (id),
  -- a minted RFC- key (mig 160); an ordinal cannot be written here
  cluster_key           text    NOT NULL REFERENCES public.refinery_complexes (cluster_key),
  members               text[]  NOT NULL,     -- refineries.id of the members at tick time (frozen)
  member_count          integer NOT NULL,
  verdict               text    NOT NULL,
  coverage_state        text    NOT NULL,

  -- primary light statistic (D-4): radiance on usable confident_clear
  -- nights carrying a retrieval; member facility-nights pooled, median per
  -- night (D-8), then the median over the window's nights. No mean column.
  baseline_nights       integer NOT NULL,
  window_nights         integer NOT NULL,
  baseline_median       numeric,
  window_median         numeric,
  baseline_min          numeric,
  baseline_max          numeric,
  window_min            numeric,
  window_max            numeric,
  light_ratio           numeric GENERATED ALWAYS AS (
                          CASE WHEN baseline_median > 0 THEN window_median / baseline_median END) STORED,
  -- overlapping ranges make a row a LEAD, never a confirmed outage (§3.1)
  distributions_overlap boolean GENERATED ALWAYS AS (
                          CASE WHEN baseline_min IS NOT NULL AND window_min IS NOT NULL
                               THEN window_max >= baseline_min AND baseline_max >= window_min END) STORED,

  -- robustness statistic (D-4, D-13): radiance_3x3 with px_hq_3x3 >= 5
  r3_baseline_nights    integer NOT NULL,
  r3_window_nights      integer NOT NULL,
  r3_baseline_median    numeric,
  r3_window_median      numeric,
  r3_light_ratio        numeric GENERATED ALWAYS AS (
                          CASE WHEN r3_baseline_median > 0 THEN r3_window_median / r3_baseline_median END) STORED,
  robustness_verdict    text,
  -- false = the verdict changes under the stricter 3x3 retrieval (Maysan today)
  robust_to_retrieval   boolean GENERATED ALWAYS AS (robustness_verdict = verdict) STORED,

  -- heat (§3.1): days with >= 1 FIRMS detection over all FIRMS days, so
  -- duplicate and twin records cannot inflate it
  baseline_firms_days   integer NOT NULL,
  baseline_heat_days    integer NOT NULL,
  window_firms_days     integer NOT NULL,
  window_heat_days      integer NOT NULL,
  baseline_heat_rate    numeric GENERATED ALWAYS AS (
                          baseline_heat_days::numeric / NULLIF(baseline_firms_days, 0)) STORED,
  window_heat_rate      numeric GENERATED ALWAYS AS (
                          window_heat_days::numeric / NULLIF(window_firms_days, 0)) STORED,
  heat_state            text,

  -- stability (§3.1, D-14): computed by lib/intel/ks.ts on the baseline's
  -- two halves; NULL for VOID rows the test was not run for
  ks_tested             boolean,
  ks_d                  numeric,
  ks_p                  numeric,

  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, cluster_key)
);

COMMENT ON TABLE public.reality_check_site_verdicts IS
  'Reality Check PR-1 (mig 161). One verdict per (run, complex), D-2 vocabulary. The CHECKs make the recorded defects unrepresentable: night floors on non-VOID rows only; HEAT_STEADY impossible at baseline heat rate <= 0.20; VOID_BASELINE_UNSTABLE forced when the KS test ran and failed; LEAD impossible without a KS test; coverage_state bound to the night counts; verdicts bound to the pinned 0.60 thresholds. No mean column, no capacity column.';
COMMENT ON COLUMN public.reality_check_site_verdicts.ks_tested IS
  'true iff baseline_nights >= 12 (the test runs); false below that (the complex may then be REFUTED or STEADY, never LEAD). NULL only on VOID rows the test was not run for (e.g. VOID_INSUFFICIENT_NIGHTS).';
COMMENT ON COLUMN public.reality_check_site_verdicts.robust_to_retrieval IS
  'Generated: robustness_verdict = verdict. false when the verdict changes under radiance_3x3 with px_hq_3x3 >= 5 (D-4, D-13).';

DO $$
BEGIN
  -- ── vocabulary ──────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_verdict_vocabulary') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_verdict_vocabulary
      CHECK (verdict IN ('STEADY', 'LIGHT_DOWN_ONLY', 'REFUTED', 'LEAD',
                         'VOID_NOT_OBSERVED', 'VOID_INSUFFICIENT_NIGHTS',
                         'VOID_BASELINE_UNSTABLE', 'VOID_HEAT_NOT_OBSERVABLE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_robustness_vocabulary') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_robustness_vocabulary
      CHECK (robustness_verdict IS NULL
             OR robustness_verdict IN ('STEADY', 'LIGHT_DOWN_ONLY', 'REFUTED', 'LEAD',
                                       'VOID_NOT_OBSERVED', 'VOID_INSUFFICIENT_NIGHTS',
                                       'VOID_BASELINE_UNSTABLE', 'VOID_HEAT_NOT_OBSERVABLE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_heat_state_vocabulary') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_heat_state_vocabulary
      CHECK (heat_state IS NULL OR heat_state IN ('HEAT_DOWN', 'HEAT_STEADY', 'HEAT_NOT_OBSERVABLE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_members') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_members
      CHECK (member_count >= 1 AND member_count = cardinality(members));
  END IF;

  -- ── coverage: a stored state bound to the counts, never an inference ─
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_coverage_follows_nights') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_coverage_follows_nights
      CHECK (coverage_state = CASE
                                WHEN window_nights = 0                            THEN 'NOT_OBSERVED'
                                WHEN baseline_nights >= 5 AND window_nights >= 3  THEN 'OBSERVED'
                                ELSE                                                   'BELOW_FLOOR'
                              END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_coverage_voids') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_coverage_voids
      CHECK ((verdict = 'VOID_NOT_OBSERVED')        = (coverage_state = 'NOT_OBSERVED')
         AND (verdict = 'VOID_INSUFFICIENT_NIGHTS') = (coverage_state = 'BELOW_FLOOR'));
  END IF;
  -- THE floor guard (§3.2): binds non-VOID rows only, so silence stays representable.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_night_floors') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_night_floors
      CHECK (verdict LIKE 'VOID_%' OR (baseline_nights >= 5 AND window_nights >= 3));
  END IF;

  -- ── the light statistic: medians, and zero is a value, never a sentinel
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_light_numbers_consistent') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_light_numbers_consistent
      CHECK (baseline_nights >= 0 AND window_nights >= 0
             AND (baseline_median IS NULL) = (baseline_nights = 0)
             AND (window_median   IS NULL) = (window_nights   = 0)
             AND (baseline_min IS NULL) = (baseline_nights = 0)
             AND (baseline_max IS NULL) = (baseline_nights = 0)
             AND (window_min   IS NULL) = (window_nights   = 0)
             AND (window_max   IS NULL) = (window_nights   = 0)
             AND (baseline_nights = 0 OR (baseline_min <= baseline_median AND baseline_median <= baseline_max))
             AND (window_nights   = 0 OR (window_min   <= window_median   AND window_median   <= window_max)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_r3_numbers_consistent') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_r3_numbers_consistent
      CHECK (r3_baseline_nights >= 0 AND r3_window_nights >= 0
             AND (r3_baseline_median IS NULL) = (r3_baseline_nights = 0)
             AND (r3_window_median   IS NULL) = (r3_window_nights   = 0));
  END IF;
  -- light-down is below 0.60 x the baseline median (D-5), for the verdict ...
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_light_matches_verdict') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_light_matches_verdict
      CHECK ((verdict NOT IN ('LEAD', 'LIGHT_DOWN_ONLY')
              OR coalesce(window_median < 0.60 * baseline_median, false))
         AND (verdict NOT IN ('REFUTED', 'STEADY')
              OR coalesce(window_median >= 0.60 * baseline_median, false)));
  END IF;
  -- ... and for the 3x3 robustness verdict, with its own floors
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_robustness_consistent') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_robustness_consistent
      CHECK ((verdict LIKE 'VOID_%' OR robustness_verdict IS NOT NULL)
         AND (robustness_verdict IS NULL OR robustness_verdict LIKE 'VOID_%'
              OR (r3_baseline_nights >= 5 AND r3_window_nights >= 3))
         AND (robustness_verdict IS NULL OR robustness_verdict NOT IN ('LEAD', 'LIGHT_DOWN_ONLY')
              OR coalesce(r3_window_median < 0.60 * r3_baseline_median, false))
         AND (robustness_verdict IS NULL OR robustness_verdict NOT IN ('REFUTED', 'STEADY')
              OR coalesce(r3_window_median >= 0.60 * r3_baseline_median, false))
         AND (robustness_verdict IS NULL OR robustness_verdict NOT IN ('REFUTED', 'LEAD')
              OR heat_state IS NOT DISTINCT FROM 'HEAT_DOWN')
         AND (robustness_verdict IS NULL OR robustness_verdict NOT IN ('STEADY', 'LIGHT_DOWN_ONLY')
              OR heat_state IS NOT DISTINCT FROM 'HEAT_STEADY'));
  END IF;

  -- ── heat: three-valued, bound to the counts (exact integer arithmetic) ─
  --   observable   : baseline heat rate > 0.20   ⇔ 5·bh > bf (and FIRMS saw the window)
  --   heat down    : window rate < 0.60 × baseline ⇔ 5·wh·bf < 3·bh·wf
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_heat_counts_sane') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_heat_counts_sane
      CHECK (baseline_firms_days >= 0 AND window_firms_days >= 0
             AND baseline_heat_days BETWEEN 0 AND baseline_firms_days
             AND window_heat_days   BETWEEN 0 AND window_firms_days);
  END IF;
  -- THE heat guard (§3.2): no HEAT_STEADY at a baseline heat rate <= 0.20
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_heat_steady_needs_observable_baseline') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_heat_steady_needs_observable_baseline
      CHECK (heat_state IS DISTINCT FROM 'HEAT_STEADY'
             OR (baseline_firms_days > 0 AND 5 * baseline_heat_days > baseline_firms_days));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_heat_state_follows_rates') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_heat_state_follows_rates
      CHECK ((heat_state IS DISTINCT FROM 'HEAT_DOWN'
              OR (baseline_firms_days > 0 AND 5 * baseline_heat_days > baseline_firms_days
                  AND window_firms_days > 0
                  AND 5 * window_heat_days * baseline_firms_days < 3 * baseline_heat_days * window_firms_days))
         AND (heat_state IS DISTINCT FROM 'HEAT_STEADY'
              OR (window_firms_days > 0
                  AND 5 * window_heat_days * baseline_firms_days >= 3 * baseline_heat_days * window_firms_days))
         AND (heat_state IS DISTINCT FROM 'HEAT_NOT_OBSERVABLE'
              OR NOT (baseline_firms_days > 0 AND 5 * baseline_heat_days > baseline_firms_days
                      AND window_firms_days > 0)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_heat_matches_verdict') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_heat_matches_verdict
      CHECK ((verdict NOT IN ('REFUTED', 'LEAD')          OR heat_state IS NOT DISTINCT FROM 'HEAT_DOWN')
         AND (verdict NOT IN ('STEADY', 'LIGHT_DOWN_ONLY') OR heat_state IS NOT DISTINCT FROM 'HEAT_STEADY')
         AND (verdict <> 'VOID_HEAT_NOT_OBSERVABLE'        OR heat_state IS NOT DISTINCT FROM 'HEAT_NOT_OBSERVABLE'));
  END IF;

  -- ── stability: the KS test (lib/intel/ks.ts) ─────────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_ks_numbers') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_ks_numbers
      CHECK ((ks_d IS NULL OR ks_d BETWEEN 0 AND 1)
         AND (ks_p IS NULL OR ks_p BETWEEN 0 AND 1)
         AND (CASE WHEN ks_tested THEN ks_d IS NOT NULL AND ks_p IS NOT NULL
                   ELSE ks_d IS NULL AND ks_p IS NULL END)
         AND (verdict LIKE 'VOID_%' OR ks_tested IS NOT NULL)
         AND (ks_tested IS NULL OR ks_tested = (baseline_nights >= 12)));
  END IF;
  -- THE stability guard (§3.2): the test ran and failed ⇒ VOID_BASELINE_UNSTABLE
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_ks_failure_forces_void') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_ks_failure_forces_void
      CHECK (NOT coalesce(ks_tested AND ks_p < 0.05, false) OR verdict = 'VOID_BASELINE_UNSTABLE');
  END IF;
  -- ... and the refusal is honest: no VOID_BASELINE_UNSTABLE without a failed test
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_unstable_needs_failed_test') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_unstable_needs_failed_test
      CHECK (verdict <> 'VOID_BASELINE_UNSTABLE' OR coalesce(ks_tested AND ks_p < 0.05, false));
  END IF;
  -- §3.1: below 12 baseline nights the complex may be REFUTED or STEADY, never LEAD
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcsv_lead_needs_ks_test') THEN
    ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_lead_needs_ks_test
      CHECK (verdict <> 'LEAD' OR ks_tested IS TRUE);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reality_check_site_verdicts_run_verdict_idx
  ON public.reality_check_site_verdicts (run_id, verdict);
CREATE INDEX IF NOT EXISTS reality_check_site_verdicts_key_idx
  ON public.reality_check_site_verdicts (cluster_key, run_id DESC);

ALTER TABLE public.reality_check_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_check_site_verdicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reality_check_runs          FROM anon, authenticated;
REVOKE ALL ON public.reality_check_site_verdicts FROM anon, authenticated;

-- ─── 3 · The classifier's read surface: medians only ───────────────────
-- Per complex and usable night: member facility-nights pooled, the median
-- taken per night (D-8). Nights come only from sensor_usable_nights (mig
-- 159), so a thin night is excluded by the join. Radiance appears only
-- inside percentile_cont(0.5); there is no average anywhere in the path.
CREATE OR REPLACE VIEW public.refinery_complex_light_nights
WITH (security_invoker = true) AS
SELECT m.cluster_key,
       u.night,
       count(*)::int                                                          AS member_rows,
       count(*) FILTER (WHERE b.cloud_confidence = 'confident_clear')::int    AS clear_members,
       count(*) FILTER (WHERE b.cloud_confidence = 'confident_clear'
                          AND b.radiance IS NOT NULL)::int                    AS retrieval_members,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY b.radiance)
         FILTER (WHERE b.cloud_confidence = 'confident_clear'
                   AND b.radiance IS NOT NULL)                                AS radiance_median,
       count(*) FILTER (WHERE b.cloud_confidence = 'confident_clear'
                          AND b.radiance_3x3 IS NOT NULL
                          AND b.px_hq_3x3 >= 5)::int                          AS retrieval_3x3_members,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY b.radiance_3x3)
         FILTER (WHERE b.cloud_confidence = 'confident_clear'
                   AND b.radiance_3x3 IS NOT NULL
                   AND b.px_hq_3x3 >= 5)                                      AS radiance_3x3_median,
       CASE
         WHEN count(*) FILTER (WHERE b.cloud_confidence = 'confident_clear' AND b.radiance IS NOT NULL) > 0
           THEN 'OBSERVED'
         WHEN count(*) FILTER (WHERE b.cloud_confidence = 'confident_clear') > 0
           THEN 'CLEAR_NO_RETRIEVAL'
         ELSE 'NOT_CLEAR'
       END                                                                    AS coverage_state
  FROM public.refinery_complex_members m
  JOIN public.sensor_usable_nights u
    ON u.sensor = 'blackmarble' AND u.facility_type = 'refinery'
  JOIN public.blackmarble_facility_radiance b
    ON b.facility_type = 'refinery'
   AND b.facility_id   = m.facility_id
   AND b.period        = u.night
 WHERE m.left_at IS NULL
 GROUP BY m.cluster_key, u.night;

COMMENT ON VIEW public.refinery_complex_light_nights IS
  'Reality Check PR-1 (mig 161). The classifier''s light input: per complex and usable Black Marble night, the MEDIAN radiance over members'' confident_clear nights carrying a retrieval (primary, D-4) and the median radiance_3x3 with px_hq_3x3 >= 5 (robustness). A complex-night with no member row on a usable night is absent (not ingested). Medians only — never a mean.';

-- Heat input: a heat day is a usable FIRMS day on which any member had
-- >= 1 detection. Counting days, not detections, is what keeps duplicate
-- and twin FIRMS records from inflating the rate.
CREATE OR REPLACE VIEW public.refinery_complex_heat_days
WITH (security_invoker = true) AS
SELECT m.cluster_key,
       u.night                                            AS day,
       count(*)::int                                      AS firms_members,
       count(*) FILTER (WHERE f.detection_count > 0)::int AS detecting_members,
       bool_or(f.detection_count > 0)                     AS heat_day
  FROM public.refinery_complex_members m
  JOIN public.sensor_usable_nights u
    ON u.sensor = 'firms' AND u.facility_type = 'refinery'
  JOIN public.firms_facility_observations f
    ON f.facility_type = 'refinery'
   AND f.facility_id   = m.facility_id
   AND f.period        = u.night
 WHERE m.left_at IS NULL
 GROUP BY m.cluster_key, u.night;

COMMENT ON VIEW public.refinery_complex_heat_days IS
  'Reality Check PR-1 (mig 161). The classifier''s heat input: per complex and usable (final) FIRMS day, whether any member had >= 1 detection. Heat rate = heat days / FIRMS days.';

REVOKE ALL ON public.refinery_complex_light_nights FROM anon, authenticated;
REVOKE ALL ON public.refinery_complex_heat_days    FROM anon, authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only. Paste these rows back.
-- ═══════════════════════════════════════════════════════════════════════

-- V1 · objects exist (expect every present = true)
SELECT 'table reality_check_runs'              AS object, to_regclass('public.reality_check_runs')          IS NOT NULL AS present
UNION ALL SELECT 'table reality_check_site_verdicts', to_regclass('public.reality_check_site_verdicts') IS NOT NULL
UNION ALL SELECT 'view refinery_complex_light_nights', to_regclass('public.refinery_complex_light_nights') IS NOT NULL
UNION ALL SELECT 'view refinery_complex_heat_days',    to_regclass('public.refinery_complex_heat_days')    IS NOT NULL
UNION ALL SELECT 'unique (run_id, cluster_key)',
                 EXISTS (SELECT 1 FROM pg_constraint
                          WHERE conrelid = 'public.reality_check_site_verdicts'::regclass AND contype = 'p')
UNION ALL SELECT 'no reality_check_issues yet (PR-6)', to_regclass('public.reality_check_issues') IS NULL;

-- V2 · every named CHECK (expect 25 rows: 6 on runs, 19 on verdicts)
SELECT conrelid::regclass AS on_table, conname
  FROM pg_constraint
 WHERE conrelid IN ('public.reality_check_runs'::regclass, 'public.reality_check_site_verdicts'::regclass)
   AND contype = 'c'
 ORDER BY 1, 2;

-- V3 · the verdict table has no mean and no capacity column (expect 0)
SELECT count(*) AS forbidden_columns
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('reality_check_runs', 'reality_check_site_verdicts',
                      'refinery_complex_light_nights', 'refinery_complex_heat_days')
   AND (column_name ~* '(mean|avg|average|capacity|bpd|barrel)');

-- V4 · the read surface on the first-tick windows (2026-09-18 expectation:
--      338 complexes with a light row; complexes with >= 5 baseline and
--      >= 3 window retrieval nights = 250)
WITH l AS (
  SELECT cluster_key,
         count(radiance_median) FILTER (WHERE night BETWEEN DATE '2026-07-18' AND DATE '2026-08-17') AS bn,
         count(radiance_median) FILTER (WHERE night BETWEEN DATE '2026-08-18' AND DATE '2026-09-01') AS wn
    FROM public.refinery_complex_light_nights
   WHERE night BETWEEN DATE '2026-07-18' AND DATE '2026-09-01'
   GROUP BY cluster_key)
SELECT count(*) AS complexes_with_light_rows,
       count(*) FILTER (WHERE bn >= 5 AND wn >= 3) AS observed_complexes
  FROM l;
