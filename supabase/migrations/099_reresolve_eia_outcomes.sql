-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 099 · Re-resolve the mis-scored EIA outcomes
--
-- ⚠️  THIS CHANGES A PUBLISHED TRACK RECORD. Read before running.
--     Apply ONLY after a deliberate decision to correct the record.
--     It is separated from the resolver fix on purpose: that fix stops
--     the corruption going forward and is safe; this one rewrites
--     history and is not.
--
-- WHAT WENT WRONG
-- The EIA resolver picked "the most recent observation ≤ resolves_at"
-- without checking it was NEWER than the baseline. EIA publishes on
-- Wednesday morning and our ingest lands later, so at scoring time the
-- newest row was still the baseline row itself — and
-- `observed < baseline` on two identical numbers is false. Every claim
-- resolved 0.
--
-- Verified against eia_inventory_observations on 2026-08-05: of the 11
-- resolved weeks, NINE were genuine draws and two were builds. The
-- register recorded a 0.000 base rate for an event that happens ~82%
-- of the time, and the house track's negative skill rested on it.
--
-- WHAT THIS DOES
-- Recomputes observed_value from the FIRST print strictly newer than
-- each claim's baseline_period, then recomputes brier, log_loss and
-- calibration_bin from the stored predicted mean. Nothing else is
-- touched: predictions themselves are immutable, and the corrected
-- rows keep their original observed_at.
--
-- The correction is expected to make the EIA family's skill LOOK
-- WORSE, not better (the forecaster was under-confident about draws,
-- predicting ~0.55 for an ~82% event). That is the point: this is not
-- score-improvement, it is score-correction.
--
-- Idempotent: re-running recomputes the same values.
-- ═══════════════════════════════════════════════════════════════

WITH truth AS (
  SELECT
    p.id AS prediction_id,
    (p.predicted_distribution->>'mean')::numeric AS predicted,
    e.value AS new_print,
    (p.context->>'baseline_kbbl')::numeric AS baseline,
    CASE WHEN e.value < (p.context->>'baseline_kbbl')::numeric THEN 1 ELSE 0 END AS observed
  FROM predictions_register p
  CROSS JOIN LATERAL (
    SELECT x.value
    FROM eia_inventory_observations x
    WHERE x.series_id = p.context->>'series_id'
      -- period is a date, the JSON value is text: the cast is required
      -- or the whole statement fails with "operator does not exist".
      AND x.period > (p.context->>'baseline_period')::date
    ORDER BY x.period ASC
    LIMIT 1
  ) e
  WHERE p.feature = 'eia_weekly_inventory'
)
UPDATE prediction_outcomes o
SET
  observed_value  = t.observed,
  brier           = round((t.predicted - t.observed)^2, 3),
  log_loss        = round((-ln(greatest(1e-6, 1 - abs(t.predicted - t.observed))))::numeric, 3),
  calibration_bin = greatest(1, least(10, floor(t.predicted * 10)::int + 1))
FROM truth t
WHERE o.prediction_id = t.prediction_id
  AND o.observed_value IS DISTINCT FROM t.observed;

-- Verification — run these and compare against the PR body before
-- considering the correction done.
--
--   SELECT round(avg(observed_value),3) AS base_rate,
--          round(avg(brier),3) AS brier, count(*)
--   FROM prediction_outcomes o
--   JOIN predictions_register p ON p.id = o.prediction_id
--   WHERE p.feature = 'eia_weekly_inventory';
--
--   Expected after correction: base_rate ≈ 0.818, n = 11
--   (was base_rate 0.000 — the value this migration exists to fix)
