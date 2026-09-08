-- 145 · Integrity: "hash-bound at issue" for house and machine, beside
--       "commit-reveal" for creators. Two guarantees, two names.
--
-- The public ledger's ② Integrity showed "commit-reveal 0 / 57" for the house
-- and "0 / 66,748" for the machine, amber, with the note "no claim in this
-- track carries a commit hash … cannot be presented as tamper-evident". That
-- is false for both tracks. commit_hash (mig 058) is the commit-reveal seal
-- for CREATOR calls — a call hidden until reveal, so hindsight cannot edit
-- it. House and machine claims are published the moment they are issued, and
-- their tamper-evidence is `hash` (mig 036): SHA-256 over the issuance
-- fields, set on every one of the 66,805 rows (missing_hash 0, seen on the
-- monitor every hour today). Measuring house and machine by a creator-only
-- mechanism reported the strongest part of the record as its weakest.
--
-- calibration_ledger_tracks() now reports both: hashed / hashed_pct next to
-- sealed / sealed_pct. The page labels house and machine "hash-bound at
-- issue" and the creator track "commit-reveal"; the warning fires only when
-- the guarantee that applies to the track is missing. Same body as mig 124
-- otherwise — nothing else in the payload changes.

CREATE OR REPLACE FUNCTION public.calibration_ledger_tracks()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH j AS (
  SELECT COALESCE(r.track, 'house') AS track,
         r.id, r.feature, r.commit_hash, r.hash, r.issued_at, r.resolves_at,
         o.prediction_id AS outcome_id,
         o.brier, o.log_loss, o.observed_value, o.calibration_bin,
         o.observed_at, o.void_reason
  FROM predictions_register r
  LEFT JOIN prediction_outcomes o ON o.prediction_id = r.id
),
s AS (  -- scored only: voids are the absence of a look, not a result
  SELECT * FROM j WHERE void_reason IS NULL AND brier IS NOT NULL
),
c AS (
  SELECT track,
         count(*)                                              AS issued,
         count(*) FILTER (WHERE commit_hash IS NOT NULL)        AS sealed,
         count(*) FILTER (WHERE hash IS NOT NULL)               AS hashed,
         count(outcome_id)                                      AS outcomes,
         count(*) FILTER (WHERE void_reason IS NOT NULL)        AS voids,
         count(*) FILTER (WHERE void_reason IS NULL
                            AND brier IS NOT NULL)              AS scored,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(epoch FROM (resolves_at - issued_at)) / 86400.0
         ) FILTER (WHERE issued_at IS NOT NULL
                     AND resolves_at IS NOT NULL
                     AND resolves_at >= issued_at)              AS median_lead
  FROM j GROUP BY track
),
h AS (
  SELECT track,
         avg(brier)          AS brier,
         avg(observed_value) AS base_rate,
         avg(abs(((calibration_bin - 0.5) / 10.0) - 0.5))
           FILTER (WHERE calibration_bin IS NOT NULL) AS sharpness
  FROM s GROUP BY track
),
bins AS (  -- set-based, not a correlated subquery per bin (§16.5)
  SELECT t.track, g.bin,
         (g.bin - 0.5) / 10.0        AS predicted,
         count(s.brier)              AS n,
         avg(s.observed_value)       AS observed
  FROM (SELECT DISTINCT track FROM j) t
  CROSS JOIN generate_series(1, 10) AS g(bin)
  LEFT JOIN s ON s.track = t.track AND s.calibration_bin = g.bin
  GROUP BY t.track, g.bin
),
hist AS (
  SELECT track,
         to_char(date_trunc('week', observed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week,
         avg(brier) AS brier,
         count(*)   AS n
  FROM s WHERE observed_at IS NOT NULL
  GROUP BY track, 2
),
fam AS (
  SELECT track, feature,
         count(*)            AS n,
         avg(brier)          AS brier,
         avg(log_loss)       AS log_loss,
         avg(observed_value) AS base_rate
  FROM s GROUP BY track, feature
)
SELECT jsonb_build_object(
  'tracks', (SELECT jsonb_object_agg(c.track, jsonb_build_object(
  'issued',   c.issued,
  'resolved', c.scored,
  'void',     c.voids,
  'open',     c.issued - c.outcomes,
  'headline', CASE WHEN h.brier IS NULL THEN NULL ELSE jsonb_build_object(
      'brier',     round(h.brier::numeric, 3),
      'base_rate', round(h.base_rate::numeric, 3),
      'skill',     CASE WHEN h.base_rate * (1 - h.base_rate) > 0
                        THEN round((1 - h.brier / (h.base_rate * (1 - h.base_rate)))::numeric, 3) END,
      'sharpness', round(h.sharpness::numeric, 3)
    ) END,
  'integrity', jsonb_build_object(
      'issued',           c.issued,
      'sealed',           c.sealed,
      'sealed_pct',       CASE WHEN c.issued > 0 THEN round(100.0 * c.sealed / c.issued)::int END,
      'hashed',           c.hashed,
      'hashed_pct',       CASE WHEN c.issued > 0 THEN round(100.0 * c.hashed / c.issued)::int END,
      'resolved_total',   c.scored + c.voids,
      'median_lead_days', round(c.median_lead::numeric, 1)
    ),
  'reliability', (
      SELECT jsonb_agg(jsonb_build_object(
               'bin', b.bin, 'predicted', b.predicted,
               'observed', CASE WHEN b.n > 0 THEN round(b.observed::numeric, 3) END,
               'n', b.n) ORDER BY b.bin)
      FROM bins b WHERE b.track = c.track),
  'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'week', x.week, 'brier', round(x.brier::numeric, 3), 'n', x.n) ORDER BY x.week)
      FROM hist x WHERE x.track = c.track), '[]'::jsonb),
  'families', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'feature',    f.feature,
               'n',          f.n,
               'brier',      round(f.brier::numeric, 3),
               'log_loss',   round(f.log_loss::numeric, 3),
               'base_rate',  round(f.base_rate::numeric, 3),
               -- A degenerate family (base rate at 0 or 1) has a baseline Brier
               -- of ~0: nothing can beat it, so skill is undefined rather than
               -- infinitely negative. The base rate beside it says why.
               'skill',      CASE WHEN f.base_rate * (1 - f.base_rate) > 0.001
                                  THEN round((1 - f.brier / (f.base_rate * (1 - f.base_rate)))::numeric, 3) END,
               'degenerate', f.base_rate * (1 - f.base_rate) <= 0.001,
               'thin',       f.n < 10) ORDER BY f.n DESC)
      FROM fam f WHERE f.track = c.track), '[]'::jsonb)
  )) FROM c LEFT JOIN h ON h.track = c.track),
  -- Counted in SQL for the same reason as the tracks: the route used to fetch
  -- every row of both tables just to tally them, and firms_significant_events
  -- (5,603 today, 3,660 in the last 30 days) will cross PostgREST's row cap
  -- and start under-reporting with nothing to show it had.
  'family_counts', (
    -- Summed by key, not object_agg'd straight off a UNION ALL: the JS this
    -- replaces added counts across both tables, and a key present in both
    -- would otherwise silently keep one side only.
    SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
      SELECT k, sum(n) AS n FROM (
        SELECT event_type AS k, count(*) AS n FROM firms_significant_events GROUP BY 1
        UNION ALL
        SELECT event_type, count(*) FROM nightlights_significant_events GROUP BY 1
      ) u GROUP BY k
    ) q)
);
$function$;

-- VERIFY (read-only): hashed = issued on house and machine; sealed unchanged.
SELECT t.key,
       t.value->'integrity'->>'issued'     AS issued,
       t.value->'integrity'->>'hashed'     AS hashed,
       t.value->'integrity'->>'hashed_pct' AS hashed_pct,
       t.value->'integrity'->>'sealed'     AS sealed
  FROM jsonb_each(public.calibration_ledger_tracks()->'tracks') AS t
 ORDER BY t.key;
