-- 136 · calibration_window_stats(): the windowed per-track figures, aggregated in SQL
--
-- WHY. The MCP tool query_calibration — the surface OTHER AGENTS call, and the
-- analyst's own tool — fetched prediction_outcomes rows with `.limit(5000)` and
-- no ORDER BY, then averaged in JS. On 2026-09-08 it reported the machine track
-- as resolved 5,000 / Brier 0.263 against a truth of 46,936 / 0.195: n
-- understated NINE times and Brier overstated by a third, on the one number
-- eYKON sells. This is #469 (mig 124) again — "a LIMIT is a window too" — on
-- the surface that was not fixed then. mig 124 aggregates the all-time ledger
-- in SQL; this does the same for a trailing window, which is what the tool's
-- contract (window_days 7|30|90, optional feature) needs.
--
-- Conventions match mig 124 exactly: scored = rows with a Brier; void = rows
-- with a void_reason, EXCLUDED from every average and never a zero; skill is
-- the relative Brier skill score 1 - Brier / (base*(1-base)), reported null
-- when the base rate is degenerate. Tracks never blend: one object per track.

CREATE OR REPLACE FUNCTION public.calibration_window_stats(
  p_days    integer DEFAULT 30,
  p_track   text    DEFAULT NULL,
  p_feature text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH rows AS (
    SELECT r.track, r.feature,
           o.brier, o.log_loss, o.void_reason, o.observed_value
      FROM prediction_outcomes o
      JOIN predictions_register r ON r.id = o.prediction_id
     WHERE o.observed_at >= now() - make_interval(days => GREATEST(p_days, 1))
       AND (p_track   IS NULL OR r.track   = p_track)
       AND (p_feature IS NULL OR r.feature = p_feature)
  ),
  per_track AS (
    SELECT track,
           COUNT(*)                                            AS resolved,
           COUNT(*) FILTER (WHERE brier IS NOT NULL)           AS scored,
           COUNT(*) FILTER (WHERE void_reason IS NOT NULL)     AS void,
           AVG(brier)    FILTER (WHERE brier IS NOT NULL)      AS avg_brier,
           AVG(log_loss) FILTER (WHERE brier IS NOT NULL)      AS avg_log_loss,
           AVG(observed_value) FILTER (WHERE brier IS NOT NULL) AS base_rate
      FROM rows GROUP BY track
  )
  SELECT COALESCE(jsonb_object_agg(track, jsonb_build_object(
           'resolved',     resolved,
           'scored',       scored,
           'unscored',     resolved - scored,
           'void',         void,
           'avg_brier',    round(avg_brier::numeric, 4),
           'avg_log_loss', round(avg_log_loss::numeric, 4),
           'base_rate',    round(base_rate::numeric, 4),
           'skill',        CASE WHEN base_rate IS NULL OR base_rate*(1-base_rate) = 0 THEN NULL
                                ELSE round((1 - avg_brier / (base_rate*(1-base_rate)))::numeric, 4) END
         )), '{}'::jsonb)
    FROM per_track;
$$;

-- STEP 1 — READ ONLY, expect (2026-09-08): machine 90d resolved 46936 / scored 46936 /
-- avg_brier 0.1949 / base 0.7957 / skill -0.1989; house 90d resolved 41 / avg_brier 0.2505 / base 0.6341 / skill -0.0796.
-- These are the SAME numbers the ledger page shows; the old tool said 5000 / 0.263.
SELECT public.calibration_window_stats(90, NULL, NULL) AS all_tracks_90d;
