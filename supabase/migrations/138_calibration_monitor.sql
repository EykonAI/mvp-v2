-- 138 · Calibration Ledger Monitor — the data contract (build-prompt v1.1, §6)
--
-- The public ledger shows RESULTS. Nothing shows FUNCTIONING: did the scorer
-- tick, did each issuer run and what did it refuse, has the instrument
-- published the window, was a night judged after its data landed. In the
-- last 48 hours five faults hid behind green results because none of that
-- was recorded anywhere a page could read. This migration records it.
--
-- Rule that shaped every table here: A ROW EXISTS IFF WE LOOKED. A scorer
-- tick that defers every claim writes no outcome row; a night judged with
-- nothing significant writes no event row. Both were read as "did not run"
-- on 2026-09-08. Run records exist so functioning is never again inferred
-- from side effects. RLS is on with no policies on every table below — the
-- service role reads and writes them, nothing else can, as on every other
-- run table.

-- ─── 1 · run records ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.score_predictions_runs (
  ran_at       timestamptz PRIMARY KEY DEFAULT now(),
  candidates   integer NOT NULL,
  scored       integer NOT NULL,
  deferred     integer NOT NULL,
  voided       integer NOT NULL DEFAULT 0,
  "limit"      integer,
  selection    text,
  due_unscored integer,
  ok           boolean NOT NULL DEFAULT true,
  error        text
);
ALTER TABLE public.score_predictions_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.issuance_runs (
  id              bigserial PRIMARY KEY,
  ran_at          timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL,          -- the register's `source` literal
  issued          integer NOT NULL,
  already_present integer,
  declined        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error           text
);
CREATE INDEX IF NOT EXISTS issuance_runs_source_ran_at_idx ON public.issuance_runs (source, ran_at DESC);
ALTER TABLE public.issuance_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ledger_watch_items (
  id         bigserial PRIMARY KEY,
  due_at     timestamptz,
  text       text NOT NULL,
  seen_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ledger_watch_items ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ledger_watch_items (due_at, text)
SELECT v.due_at::timestamptz, v.text FROM (VALUES
  ('2026-09-08 12:00+00', 'Nights 08-25 and 08-26 re-judged on full data (run nightlights_detect_recent(5) once; the job should re-judge refilled nights on its own)'),
  ('2026-09-09 12:00+00', 'First FIRMS recovery claims resolve (windows end 09-08/09) — the VOID path on uncovered windows must be seen'),
  ('2026-09-10 00:00+00', 'First #470 box-conditioned machine cohort (issued 09-06) completes — expect skill near 0, not +0.296'),
  ('2026-09-12 12:00+00', 'Night-lights families reach n≈100 resolved — first quotable realised skill vs +0.163 / +0.091 out-of-sample')
) AS v(due_at, text)
WHERE NOT EXISTS (SELECT 1 FROM public.ledger_watch_items w WHERE w.text = v.text);

-- ─── 2 · windowed per-family statistics, in SQL, no LIMIT ──────────────
--
-- Same conventions as migrations 124 and 136: scored = has a Brier; void
-- excluded from every average, never a zero; skill = 1 − Brier / base(1−base),
-- NULL when the base rate is degenerate; reliability bins set-based over
-- generate_series (never a correlated subquery per bin). p_basis chooses
-- which timestamp the window applies to: 'resolved' = observed_at (what the
-- public tools use), 'issued' = issued_at over resolved claims (the cohort
-- view). Tracks and families are reported separately; nothing blends.

CREATE OR REPLACE FUNCTION public.calibration_family_stats(
  p_from    timestamptz,
  p_to      timestamptz,
  p_basis   text DEFAULT 'resolved',
  p_track   text DEFAULT NULL,
  p_feature text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH j AS (
    SELECT r.track, r.feature,
           o.brier, o.log_loss, o.void_reason, o.observed_value, o.calibration_bin,
           (r.predicted_distribution->>'mean')::numeric AS p
      FROM prediction_outcomes o
      JOIN predictions_register r ON r.id = o.prediction_id
     WHERE (p_track   IS NULL OR r.track   = p_track)
       AND (p_feature IS NULL OR r.feature = p_feature)
       AND CASE WHEN p_basis = 'issued'
                THEN r.issued_at   >= p_from AND r.issued_at   < p_to
                ELSE o.observed_at >= p_from AND o.observed_at < p_to END
  ),
  s AS (SELECT * FROM j WHERE void_reason IS NULL AND brier IS NOT NULL),
  fam AS (
    SELECT track, feature,
           count(*)                                                  AS resolved,
           count(*) FILTER (WHERE void_reason IS NULL AND brier IS NOT NULL) AS scored,
           count(*) FILTER (WHERE void_reason IS NOT NULL)           AS void
      FROM j GROUP BY track, feature),
  fs AS (
    SELECT track, feature, avg(brier) AS brier, avg(log_loss) AS log_loss,
           avg(observed_value) AS base_rate, avg(abs(p - 0.5)) AS sharpness
      FROM s GROUP BY track, feature),
  bins AS (
    SELECT f.track, f.feature, g.bin, (g.bin - 0.5) / 10.0 AS predicted,
           count(s.brier) AS n, avg(s.observed_value) AS observed
      FROM (SELECT DISTINCT track, feature FROM s) f
      CROSS JOIN generate_series(1, 10) AS g(bin)
      LEFT JOIN s ON s.track = f.track AND s.feature = f.feature AND s.calibration_bin = g.bin
     GROUP BY f.track, f.feature, g.bin),
  tr AS (
    SELECT track,
           count(*)                                                  AS resolved,
           count(*) FILTER (WHERE void_reason IS NULL AND brier IS NOT NULL) AS scored,
           count(*) FILTER (WHERE void_reason IS NOT NULL)           AS void
      FROM j GROUP BY track),
  ts AS (
    SELECT track, avg(brier) AS brier, avg(log_loss) AS log_loss,
           avg(observed_value) AS base_rate, avg(abs(p - 0.5)) AS sharpness
      FROM s GROUP BY track),
  tbins AS (
    SELECT t.track, g.bin, (g.bin - 0.5) / 10.0 AS predicted,
           count(s.brier) AS n, avg(s.observed_value) AS observed
      FROM (SELECT DISTINCT track FROM s) t
      CROSS JOIN generate_series(1, 10) AS g(bin)
      LEFT JOIN s ON s.track = t.track AND s.calibration_bin = g.bin
     GROUP BY t.track, g.bin)
  SELECT jsonb_build_object(
    'basis', p_basis, 'from', p_from, 'to', p_to,
    'tracks', COALESCE((
      SELECT jsonb_object_agg(tr.track, jsonb_build_object(
        'resolved', tr.resolved, 'scored', tr.scored, 'void', tr.void,
        'brier',     round(ts.brier::numeric, 4),
        'log_loss',  round(ts.log_loss::numeric, 4),
        'base_rate', round(ts.base_rate::numeric, 4),
        'sharpness', round(ts.sharpness::numeric, 4),
        'skill',     CASE WHEN ts.base_rate * (1 - ts.base_rate) > 0.001
                          THEN round((1 - ts.brier / (ts.base_rate * (1 - ts.base_rate)))::numeric, 4) END,
        'reliability', (SELECT jsonb_agg(jsonb_build_object('bin', b.bin, 'predicted', round(b.predicted::numeric, 2),
                                                             'n', b.n, 'observed', round(b.observed::numeric, 3)) ORDER BY b.bin)
                          FROM tbins b WHERE b.track = tr.track)))
        FROM tr LEFT JOIN ts USING (track)), '{}'::jsonb),
    'families', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'track', fam.track, 'feature', fam.feature,
        'resolved', fam.resolved, 'scored', fam.scored, 'void', fam.void,
        'brier',     round(fs.brier::numeric, 4),
        'log_loss',  round(fs.log_loss::numeric, 4),
        'base_rate', round(fs.base_rate::numeric, 4),
        'sharpness', round(fs.sharpness::numeric, 4),
        'skill',     CASE WHEN fs.base_rate * (1 - fs.base_rate) > 0.001
                          THEN round((1 - fs.brier / (fs.base_rate * (1 - fs.base_rate)))::numeric, 4) END,
        'reliability', (SELECT jsonb_agg(jsonb_build_object('bin', b.bin, 'predicted', round(b.predicted::numeric, 2),
                                                             'n', b.n, 'observed', round(b.observed::numeric, 3)) ORDER BY b.bin)
                          FROM bins b WHERE b.track = fam.track AND b.feature = fam.feature)
      ) ORDER BY fam.track, fam.feature)
        FROM fam LEFT JOIN fs USING (track, feature)), '[]'::jsonb)
  );
$$;

-- ─── 2b · the machine cohorts broken out per AIS box ────────────────────
--
-- Mig 137 gives the series per track; the admin view also needs it per box,
-- because the box rule (#470) is a per-box forecaster and a dead box (#479)
-- voids only its own claims. Same conventions: a cohort is comparable only
-- when every claim in it has passed its deadline; voids excluded.

CREATE OR REPLACE FUNCTION public.calibration_cohorts_by_box(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH j AS (
    SELECT COALESCE(r.context->>'box_slug', '(no box)') AS box,
           (r.issued_at AT TIME ZONE 'UTC')::date AS day,
           r.resolves_at, o.prediction_id, o.brier, o.observed_value, o.void_reason,
           (r.predicted_distribution->>'mean')::numeric AS p
      FROM predictions_register r
      LEFT JOIN prediction_outcomes o ON o.prediction_id = r.id
     WHERE r.track = 'machine' AND r.source = 'ais-darkgap'
       AND r.issued_at >= now() - make_interval(days => GREATEST(p_days, 1))
  ),
  g AS (
    SELECT box, day, count(*) AS issued,
           count(*) FILTER (WHERE void_reason IS NULL AND brier IS NOT NULL) AS n,
           count(*) FILTER (WHERE prediction_id IS NULL)                     AS open,
           count(*) FILTER (WHERE void_reason IS NOT NULL)                   AS void,
           bool_and(resolves_at <= now())                                    AS complete,
           avg(brier)          FILTER (WHERE void_reason IS NULL AND brier IS NOT NULL) AS brier,
           avg(observed_value) FILTER (WHERE void_reason IS NULL AND brier IS NOT NULL) AS base_rate,
           avg(abs(p - 0.5))   FILTER (WHERE void_reason IS NULL AND brier IS NOT NULL) AS sharpness
      FROM j GROUP BY box, day)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'box', box, 'day', day, 'issued', issued, 'n', n, 'open', open, 'void', void, 'complete', complete,
           'brier', round(brier::numeric, 4), 'base_rate', round(base_rate::numeric, 4), 'sharpness', round(sharpness::numeric, 4),
           'skill', CASE WHEN base_rate * (1 - base_rate) > 0.001
                         THEN round((1 - brier / (base_rate * (1 - base_rate)))::numeric, 4) END)
           ORDER BY day, box), '[]'::jsonb)
    FROM g;
$$;

-- ─── 3 · pg_cron, read from public without exposing the cron schema ────

CREATE OR REPLACE FUNCTION public.pg_cron_recent_runs(
  p_jobs  text[]  DEFAULT ARRAY['refresh-vessel-cadence', 'detect-nightlights'],
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT COALESCE(jsonb_object_agg(j.jobname, jsonb_build_object(
    'schedule', j.schedule, 'active', j.active,
    'runs', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'status', d.status, 'start', d.start_time,
               'secs', round(extract(epoch FROM d.end_time - d.start_time)::numeric, 1),
               'message', left(d.return_message, 120)) ORDER BY d.start_time DESC), '[]'::jsonb)
             FROM (SELECT * FROM cron.job_run_details x WHERE x.jobid = j.jobid
                   ORDER BY x.start_time DESC LIMIT GREATEST(p_limit, 1)) d)
  )), '{}'::jsonb)
    FROM cron.job j WHERE j.jobname = ANY (p_jobs);
$$;
REVOKE ALL ON FUNCTION public.pg_cron_recent_runs(text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_cron_recent_runs(text[], integer) TO service_role;

-- ─── 4 · pipeline health in one read ───────────────────────────────────
--
-- One STABLE function so the page pays one round trip for the facts that
-- rarely fail. The plan RPCs and the house gate are read separately by the
-- page so a failure in one of them reddens its own card and nothing else.

CREATE OR REPLACE FUNCTION public.calibration_monitor_health()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'scorer', (SELECT to_jsonb(s) FROM (SELECT ran_at, candidates, scored, deferred, voided, "limit", selection, due_unscored, ok, error
                                          FROM public.score_predictions_runs ORDER BY ran_at DESC LIMIT 1) s),
    'queue', jsonb_build_object(
      'due', public.due_unscored_predictions_count(),
      'by_source', (SELECT COALESCE(jsonb_agg(jsonb_build_object('source', q.source, 'n', q.n, 'oldest_due', q.oldest) ORDER BY q.n DESC), '[]'::jsonb)
                      FROM (SELECT r.source, count(*) AS n, min(r.resolves_at) AS oldest
                              FROM predictions_register r LEFT JOIN prediction_outcomes o ON o.prediction_id = r.id
                             WHERE o.prediction_id IS NULL AND r.resolves_at < now() GROUP BY r.source) q)),
    'clocks', jsonb_build_object(
      'firms',       (SELECT max(period) FROM firms_facility_observations),
      'blackmarble', (SELECT max(period) FROM blackmarble_facility_radiance),
      'ais',         (SELECT max(recorded_at) FROM ais_position_history)),
    'blackmarble_newest_night', (SELECT to_jsonb(b) FROM (SELECT night, tiles_expected, tiles_processed, tiles_missing, facilities_written, ok, error, ran_at
                                                            FROM public.blackmarble_ingest_runs WHERE tiles_processed > 0 ORDER BY night DESC LIMIT 1) b),
    'blackmarble_last_run', (SELECT to_jsonb(b) FROM (SELECT night, tiles_expected, tiles_processed, tiles_missing, facilities_written, ok, error, ran_at
                                                        FROM public.blackmarble_ingest_runs ORDER BY ran_at DESC LIMIT 1) b),
    -- The worker's roster is what it has demonstrated on a complete night
    -- (10,556), NOT firms_monitored_facilities (183,051 — every refinery and
    -- plant); measured against the view, every night would read partial.
    'blackmarble_roster', (SELECT max(facilities_written) FROM public.blackmarble_ingest_runs
                            WHERE ok AND ran_at > now() - interval '60 days'),
    'firms_ingest', jsonb_build_object(
      'last_run',  (SELECT max(ran_at) FROM public.firms_ingest_runs),
      'ok_6h',     (SELECT count(*) FROM public.firms_ingest_runs WHERE ran_at > now() - interval '6 hours' AND ok),
      'failed_6h', (SELECT count(*) FROM public.firms_ingest_runs WHERE ran_at > now() - interval '6 hours' AND NOT ok)),
    'detect_runs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('night', d.night, 'events', d.events, 'judged_at', d.judged_at, 'duration_ms', d.duration_ms) ORDER BY d.night DESC), '[]'::jsonb)
                      FROM (SELECT * FROM public.nightlights_detect_runs ORDER BY night DESC LIMIT 6) d),
    'firms_events_newest', (SELECT max(created_at) FROM public.firms_significant_events),
    -- A night needs (re-)judging when its newest ingest run is newer than its
    -- detect run, or it has none. Only nights since run records began can be
    -- judged this way: earlier nights were judged by the route, which wrote
    -- events but no run row, and read as "never judged" (48 false nights on
    -- 2026-09-08 before this bound was added).
    'detect_runs_since', (SELECT min(night) FROM public.nightlights_detect_runs),
    'rejudge_needed', (SELECT COALESCE(jsonb_agg(i.night ORDER BY i.night), '[]'::jsonb)
                         FROM public.blackmarble_ingest_runs i
                        WHERE i.facilities_written > 0
                          AND i.night >= (SELECT min(night) FROM public.nightlights_detect_runs)
                          AND NOT EXISTS (SELECT 1 FROM public.nightlights_detect_runs d
                                           WHERE d.night = i.night AND d.judged_at >= i.ran_at)),
    'boxes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', b.slug, 'kind', b.kind,
                 'silent_hours', round(extract(epoch FROM now() - b.newest_fix) / 3600.0, 1),
                 'vessels', b.vessels, 'fixes_last_hour', b.fixes_last_hour) ORDER BY b.newest_fix), '[]'::jsonb)
                FROM public.ais_box_liveness b),
    'boxes_computed_at', (SELECT max(computed_at) FROM public.ais_box_liveness),
    'issuance_24h', (SELECT COALESCE(jsonb_agg(jsonb_build_object('source', i.source, 'issued', i.n) ORDER BY i.n DESC), '[]'::jsonb)
                       FROM (SELECT source, count(*) AS n FROM predictions_register WHERE issued_at > now() - interval '24 hours' GROUP BY source) i),
    'issuance_runs', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.ran_at DESC), '[]'::jsonb)
                        FROM (SELECT DISTINCT ON (source) source, ran_at, issued, already_present, declined, error
                                FROM public.issuance_runs ORDER BY source, ran_at DESC) x),
    'integrity', (SELECT COALESCE(jsonb_object_agg(t.track, jsonb_build_object(
                     'issued', t.issued, 'scored', t.scored, 'void', t.void, 'pending', t.pending,
                     'missing_hash', t.missing_hash, 'sealed', t.sealed,
                     'reconciles', t.issued = t.scored + t.void + t.pending)), '{}'::jsonb)
                    FROM (SELECT r.track, count(*) AS issued,
                                 count(o.prediction_id) FILTER (WHERE o.void_reason IS NULL)     AS scored,
                                 count(o.prediction_id) FILTER (WHERE o.void_reason IS NOT NULL) AS void,
                                 count(*) FILTER (WHERE o.prediction_id IS NULL)                  AS pending,
                                 count(*) FILTER (WHERE r.hash IS NULL)                           AS missing_hash,
                                 count(*) FILTER (WHERE r.commit_hash IS NOT NULL)                AS sealed
                            FROM predictions_register r LEFT JOIN prediction_outcomes o ON o.prediction_id = r.id
                           GROUP BY r.track) t),
    -- Live check of the #482 rule against the CURRENT clocks: an outcome whose
    -- window end is at or after the instrument's newest published period was
    -- judged on unpublished data. (A historical premature judgement stops
    -- matching once the clock passes it; this is the live alert, not the audit.)
    'judged_unpublished', (SELECT count(*) FROM prediction_outcomes o JOIN predictions_register r ON r.id = o.prediction_id
                            WHERE r.source IN ('blackmarble', 'firms-recovery')
                              AND ((r.context->>'flagged_period')::date + (r.context->>'horizon_days')::int)
                                  >= CASE r.source WHEN 'blackmarble' THEN (SELECT max(period) FROM blackmarble_facility_radiance)
                                                   ELSE (SELECT max(period) FROM firms_facility_observations) END),
    'source_check', (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                      WHERE c.conrelid = 'public.predictions_register'::regclass AND c.conname = 'predictions_register_source_check'),
    'sources_in_use', (SELECT COALESCE(jsonb_agg(DISTINCT source), '[]'::jsonb) FROM predictions_register),
    'families', (SELECT COALESCE(jsonb_agg(jsonb_build_object('track', f.track, 'feature', f.feature, 'source', f.source,
                                                              'issued', f.issued, 'newest', f.newest) ORDER BY f.track, f.feature), '[]'::jsonb)
                   FROM (SELECT COALESCE(r.track, 'house') AS track, r.feature, r.source, count(*) AS issued, max(r.issued_at) AS newest
                           FROM predictions_register r GROUP BY 1, 2, 3) f)
  );
$$;

REVOKE ALL ON FUNCTION public.calibration_family_stats(timestamptz, timestamptz, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calibration_family_stats(timestamptz, timestamptz, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.calibration_cohorts_by_box(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calibration_cohorts_by_box(integer) TO service_role;
REVOKE ALL ON FUNCTION public.calibration_monitor_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calibration_monitor_health() TO service_role;

-- STEP 1 — READ ONLY. Every function body below was run against production
-- read-only on 2026-09-08 11:40 UTC before this file was committed; expect:
-- scorer NULL and issuance_runs [] until the first ticks after deploy write
-- rows; queue.due 178 (blackmarble 162 · firms-recovery 8 · ais 6 · polymarket 2);
-- clocks firms 2026-09-08 / blackmarble 2026-08-29 / ais within the hour;
-- detect_runs newest 2026-08-29 (1,777 ms); rejudge_needed ['2026-08-25','2026-08-26'];
-- blackmarble_roster 10556; boxes 10, bab-el-mandeb silent ~1,245 h; integrity
-- house 57 = 45 + 0 + 12, machine 66,683 = 46,979 + 2 + 19,702, missing_hash 0;
-- judged_unpublished 0; family_stats all: house 45 / 0.2504 / −0.0929,
-- machine 46,979 / 0.1948 / −0.1979 (identical to calibration_ledger_tracks()).
SELECT public.calibration_monitor_health();
SELECT public.calibration_family_stats(now() - interval '90 days', now(), 'resolved', NULL, NULL);
SELECT public.pg_cron_recent_runs();
SELECT public.calibration_cohorts_by_box(14);
