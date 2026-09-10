-- 157 · calibration_window_stats(): say where the scored rows actually sit,
--       and default the window to 90 days
--
-- WHY THE DATE RANGE. window_days is advertised as a filter. For the machine
-- track it currently is not one. Measured 2026-09-10 against production:
--
--     window   machine scored   avg_brier   skill
--       7d          50,665        0.2031   -0.1762
--      30d          50,666        0.2031   -0.1762
--      90d          50,666        0.2031   -0.1762
--
-- One row of difference across a thirteen-fold change in window. The cause is
-- benign — the scorer only began draining its backlog on 2026-09-09 (#506/#507,
-- migs 150), so nearly every machine outcome carries an observed_at inside the
-- last few days and every window catches the same rows. But an agent comparing
-- 7d against 90d reads that as "performance is remarkably stable" when it was
-- handed the same 50,666 rows twice. A parameter that looks like it
-- discriminates and does not is the same defect as query_vessels reporting its
-- page size as the count (#517): the number is right and the thing it appears
-- to describe is not.
--
-- So report the truth alongside the request. The obvious field — a min-to-max
-- span — was drafted first and REJECTED on measurement: the machine track spans
-- 13.5 days only because ONE row sits at 2026-08-28 while the other 50,665 fall
-- inside the last seven. A span is an outlier's opinion, so shipping it would
-- have reproduced the very defect this migration exists to fix.
--
-- The robust pair instead: observed_median (where the mass of the scored rows
-- actually sits) and pct_scored_last_7d (what share of them are from the last
-- week). Measured 2026-09-10 at p_days = 90: machine 100.0%, median 09-06 —
-- unmistakable; house 14.3%, median 07-27 — genuinely spread. A caller asking
-- for 90 days and reading 100% can see at a glance that the window did not
-- bind. observed_from / observed_to stay because the actual endpoints are worth
-- knowing; they are simply not the summary. This self-heals as the backlog
-- clears, and the fields stay useful because they will then show it binding.
--
-- WHY THE DEFAULT MOVES 30 -> 90. Not because 90 flatters — it does, but that
-- is not the reason and would be a bad one. The house track has scored n=6 at
-- 7d, n=12 at 30d and n=42 at 90d, and skill is computed against the track's
-- OWN base rate inside the window: at 7d that yardstick rests on six outcomes,
-- so it is noise measured against noise. The tool's own note already says "A
-- Brier over a handful of scored rows carries no weight" — a 30-day default
-- made it disregard its own advice. 90 is the shortest window where the house
-- track carries evidence. Callers who want 7 or 30 still pass window_days, and
-- the public ledger page carries every period.
--
-- Conventions unchanged from mig 136: scored = rows with a Brier; void rows are
-- EXCLUDED from every average and never counted as zero; skill is the relative
-- Brier skill score 1 - Brier / (base*(1-base)), null when the base rate is
-- degenerate; tracks never blend.
--
-- Apply MANUALLY in the Supabase SQL Editor BEFORE merge.

CREATE OR REPLACE FUNCTION public.calibration_window_stats(
  p_days    integer DEFAULT 90,
  p_track   text    DEFAULT NULL,
  p_feature text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH rows AS (
    SELECT r.track, r.feature,
           o.brier, o.log_loss, o.void_reason, o.observed_value, o.observed_at
      FROM prediction_outcomes o
      JOIN predictions_register r ON r.id = o.prediction_id
     WHERE o.observed_at >= now() - make_interval(days => GREATEST(p_days, 1))
       AND (p_track   IS NULL OR r.track   = p_track)
       AND (p_feature IS NULL OR r.feature = p_feature)
  ),
  per_track AS (
    SELECT track,
           COUNT(*)                                             AS resolved,
           COUNT(*) FILTER (WHERE brier IS NOT NULL)            AS scored,
           COUNT(*) FILTER (WHERE void_reason IS NOT NULL)      AS void,
           AVG(brier)    FILTER (WHERE brier IS NOT NULL)       AS avg_brier,
           AVG(log_loss) FILTER (WHERE brier IS NOT NULL)       AS avg_log_loss,
           AVG(observed_value) FILTER (WHERE brier IS NOT NULL) AS base_rate,
           -- All of these describe the SCORED rows only: the ones in the average.
           MIN(observed_at) FILTER (WHERE brier IS NOT NULL)    AS observed_from,
           MAX(observed_at) FILTER (WHERE brier IS NOT NULL)    AS observed_to,
           PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY observed_at)
             FILTER (WHERE brier IS NOT NULL)                   AS observed_median,
           COUNT(*) FILTER (WHERE brier IS NOT NULL
                              AND observed_at >= now() - interval '7 days')
                                                                AS scored_last_7d
      FROM rows GROUP BY track
  )
  SELECT COALESCE(jsonb_object_agg(track, jsonb_build_object(
           'resolved',      resolved,
           'scored',        scored,
           'unscored',      resolved - scored,
           'void',          void,
           'avg_brier',     round(avg_brier::numeric, 4),
           'avg_log_loss',  round(avg_log_loss::numeric, 4),
           'base_rate',     round(base_rate::numeric, 4),
           'skill',         CASE WHEN base_rate IS NULL OR base_rate*(1-base_rate) = 0 THEN NULL
                                 ELSE round((1 - avg_brier / (base_rate*(1-base_rate)))::numeric, 4) END,
           'observed_from',   observed_from,
           'observed_to',     observed_to,
           'observed_median', observed_median,
           'scored_last_7d',  scored_last_7d,
           -- 100 on a 90-day request means the window did not bind.
           'pct_scored_last_7d',
             CASE WHEN scored = 0 THEN NULL
                  ELSE round(100.0 * scored_last_7d / scored, 1) END
         )), '{}'::jsonb)
    FROM per_track;
$$;

COMMENT ON FUNCTION public.calibration_window_stats(integer, text, text) IS
  'Windowed per-track calibration. Default window 90d — the shortest window where the house track carries evidence (n=42 vs 12 at 30d, 6 at 7d), and skill is measured against the track''s own base rate inside the window, so a short window computes its yardstick from the same handful of rows. observed_median and pct_scored_last_7d describe where the SCORED rows actually sit: pct_scored_last_7d near 100 on a long window means the window did not bind, which was true of the machine track (100.0%) throughout the 2026-09 backlog drain while house read 14.3%. A min-to-max span was deliberately NOT used — one 2026-08-28 row stretched the machine span to 13.5 days while 50,665 of 50,666 rows sat inside seven.';

-- STEP 1 — READ ONLY. Expect (measured 2026-09-10): machine scored 50666,
-- pct_scored_last_7d 100.0, median 2026-09-06 — the window not binding, which
-- is the whole point of the new fields. House scored 42, pct 14.3, median
-- 2026-07-27, skill -0.0781. Machine skill -0.1762.
SELECT public.calibration_window_stats(90, NULL, NULL) AS all_tracks_90d;
