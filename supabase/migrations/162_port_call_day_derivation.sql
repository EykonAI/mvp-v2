-- ═══════════════════════════════════════════════════════════════════════════
-- eYKON.ai — 162 · Port calls derived per UTC day, on pg_cron, with a run record
--            for every day. Reality Check programme PR-2 (part 1 of 2), build
--            prompt rev H §4.2. Part 2 is migration 163 (coverage view, honest
--            consumers, decoupled retention). Apply 162, then 163.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PURPOSE
-- -------
-- port_calls has written nothing since 2026-09-11 01:46:05 UTC. Every nightly
-- derive_port_calls(p_since) call arrives over PostgREST, where the
-- `authenticator` role carries statement_timeout = 8s, and is cancelled with
-- SQLSTATE 57014. After the 2026-08-24 AIS step (~430–525k positions a day)
-- the function no longer fits in 8 s, and no HTTP timeout can lift a
-- database-side limit. Migration 122 already learned this for
-- refresh_vessel_cadence ("Do not call over the API"); the derivation was
-- never moved. This file moves it, and re-keys it on the UTC day.
--
-- MEASURED, read-only, 2026-09-18 (supabase-ro)
--   · The Railway cron still fires: session 01:44:54 UTC, cancelled 01:45:02.241,
--     sql_state 57014, context "PL/pgSQL function derive_port_calls(timestamp
--     with time zone) line 65" (the INSERT), user authenticator.
--   · Role settings: authenticator statement_timeout=8s; the database default
--     is 120 s — what pg_cron and the SQL Editor run under.
--   · The day-keyed atom query for 2026-09-17 (EXPLAIN ANALYZE): 9.3 s;
--     348,113 slow samples → 155,311 within 3 km of a port → 14,489 atoms;
--     14.5 s with the arrival/departure evidence look-ups. It fits pg_cron's
--     120 s. It could never fit PostgREST's 8 s.
--   · port_calls: 88,598 rows from 30 successful runs; 21,435 with
--     departed_at NULL. ais_position_history: 11.78 M rows, 3,039 MB,
--     2026-07-05 → now, never pruned. UTC days with zero samples: 07-21,
--     08-06 → 08-16 (the AIS outage), 08-20, 08-21.
--   · Vessel-port-days per day, 09-04 → 09-17: 11,338 … 13,645 (max/min 1.20).
--   · Rows sampled after 00:17 UTC of the next day, for days 09-10 → 09-16:
--     0 of 3,336,632 — deriving day D at 00:17 on D+1 sees the whole day.
--
-- WHAT THIS FILE CREATES
--   port_call_first_day()        the sampler's first day (2026-07-05), pinned.
--   port_call_derivation_runs    ONE ROW PER UTC DAY ATTEMPTED — derived,
--                                samples_absent (the AIS layer held no sample
--                                that day: VOID, never zero) or failed. A day
--                                with no row was never attempted.
--   port_call_days               the stored atom: one vessel's slow-near-port
--                                segment at one port within one UTC day (a new
--                                segment after a > 6 h gap, as in mig 078), with
--                                the vessel's own previous/next fix within 6 h —
--                                the evidence an arrival or departure was seen.
--   derive_port_call_day(date)   derives one completed UTC day. Re-derivation is
--                                a replacement (the day's atoms are deleted and
--                                rewritten), then the episodes touching that day
--                                are rebuilt. Refuses a day whose raw history
--                                has been pruned (mig 163).
--   rebuild_port_calls(date,date) rolls atoms up into port_calls episodes
--                                (derived_by = 'v2_day') for the islands touching
--                                [from − 1, to + 1]. Idempotent: a re-run writes
--                                nothing.
--   derive_port_calls_due(int,int) the pg_cron entry point, pattern of mig 140's
--                                nightlights_detect_due: derives up to N days
--                                that have no run record (or failed) — the
--                                most recent completed day first, then the
--                                backlog oldest-first — and starts no new day
--                                after a 60 s budget (a post-step day is
--                                ~15–20 s; the call must end inside 120 s or
--                                every day in it rolls back). A missed night
--                                self-heals at the next tick instead of being
--                                lost.
--   cron job 'derive-port-calls' 00:17 and 12:17 UTC, derive_port_calls_due(3).
--                                Staggered off the busy minutes: the hourly
--                                sampler (:05, done by :10), the scorer (:07),
--                                the Black Marble plan cache (:12), and the
--                                FIRMS derivation that times out at :03–:07 and
--                                :25–:41 (it collided with the old 01:40 job).
--
-- WHAT THIS FILE CHANGES ON port_calls
--   · New columns: derived_by ('v1_window' for all 88,598 existing rows,
--     'v2_day' for rows this derivation writes), arrival_observed,
--     departure_observed, day_count. Legacy rows keep NULL evidence (unknown).
--   · The unique key becomes (mmsi, port_id, arrived_at, derived_by): the two
--     generations must coexist until the founder has compared them day by day,
--     and a v2 episode usually starts on the same first sample as its v1 row.
--   · The missing (port_id, arrived_at) index, plus a partial index on
--     departed_at for v2 rows (the rebuild's window scan).
--   · Legacy rows are NOT deleted here, or anywhere in this PR.
--
-- WHAT THIS FILE RETIRES
--   derive_port_calls(timestamptz) keeps its signature and grants but now
--   raises "retired by migration 162". Between applying this file and merging
--   the PR, the Railway cron gets that message instead of a timeout. After
--   merge the route no longer calls it. Pause or delete the Railway service.
--
-- THE HONESTY RULES THE DATA NOW CARRIES
--   · arrival_observed = true only when the vessel's own previous fix within
--     6 h exists and was NOT slow within 3 km of this port. A vessel first seen
--     already berthed — after a feed outage, after a missed day, on the day the
--     fleet grew (08-24), or with a transponder gap — has arrived_at as a lower
--     bound, arrival_observed = false. That is what kills the phantom arrivals
--     the v1 window manufactured after every missed night. Measured on 09-16 /
--     09-17: 5,622 / 5,558 observed arrivals of 14,539 / 14,489 segment starts.
--   · departure_observed mirrors it on the trailing edge; departed_at is the
--     last slow fix and is never NULL on a v2 row.
--   · sample_count is the sum of the island's atoms and cannot accumulate on
--     re-derivation.
--
-- APPLY: the whole file, in the Supabase SQL Editor, BEFORE merging the PR.
-- The final SELECT is the VERIFY block: paste its rows back. Idempotent — safe
-- to re-run. No temp tables, no session state.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─── 0 · The span ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.port_call_first_day()
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT date '2026-07-05' $$;

COMMENT ON FUNCTION public.port_call_first_day() IS
  'First UTC day of ais_position_history (the mig-078 sampler started 2026-07-05). The port-call derivation span starts here and never moves, so pruning raw history never shrinks the coverage record (mig 162).';

-- ─── 1 · The run record ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.port_call_derivation_runs (
  day              date        PRIMARY KEY,
  status           text        NOT NULL,
  samples_scanned  integer     NOT NULL DEFAULT 0,  -- ais_position_history rows dated this UTC day
  slow_samples     integer     NOT NULL DEFAULT 0,  -- of which speed < 0.5 kn with a position
  near_samples     integer     NOT NULL DEFAULT 0,  -- slow samples within 3 km of a port (one per port matched)
  atoms            integer     NOT NULL DEFAULT 0,  -- rows written to port_call_days
  vessel_days      integer     NOT NULL DEFAULT 0,  -- distinct (mmsi, port_id): the daily acceptance series
  ports_touched    integer     NOT NULL DEFAULT 0,
  live_hours       smallint    NOT NULL DEFAULT 0,  -- distinct UTC hours holding ≥ 1 sample; 24 = a full day
  duration_ms      integer,
  error            text,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  raw_pruned_at    timestamptz,                     -- set by prune_ais_position_history (mig 163)
  raw_rows_pruned  integer,
  CONSTRAINT port_call_derivation_runs_status_check
    CHECK (status IN ('derived', 'samples_absent', 'failed')),
  CONSTRAINT port_call_derivation_runs_shape_check
    CHECK (   (status = 'derived'        AND samples_scanned > 0 AND live_hours BETWEEN 1 AND 24)
           OR (status = 'samples_absent' AND samples_scanned = 0 AND atoms = 0 AND vessel_days = 0 AND live_hours = 0)
           OR (status = 'failed'         AND error IS NOT NULL)),
  CONSTRAINT port_call_derivation_runs_pruned_check
    CHECK (raw_pruned_at IS NULL OR status = 'derived')
);

COMMENT ON TABLE public.port_call_derivation_runs IS
  'One row per UTC day the port-call derivation attempted (mig 162). derived = the day was scanned (live_hours < 24 marks a partial feed day); samples_absent = ais_position_history held no sample that day — VOID, never zero; failed = attempted and errored (retried by derive_port_calls_due). No row = never attempted: read as no data, never as zero. raw_pruned_at = that day''s raw history was deleted by prune_ais_position_history (mig 163) and the day can no longer be re-derived.';

ALTER TABLE public.port_call_derivation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.port_call_derivation_runs FROM anon, authenticated;

-- ─── 2 · The atom ──────────────────────────────────────────────────────────
-- No FK to ports(id) on purpose: a port row retired later must not make a
-- historical day unrewritable.
CREATE TABLE IF NOT EXISTS public.port_call_days (
  mmsi              text        NOT NULL,
  port_id           text        NOT NULL,
  day               date        NOT NULL,
  seq               integer     NOT NULL,   -- segment ordinal within the day (> 6 h gap starts a new one)
  first_at          timestamptz NOT NULL,
  last_at           timestamptz NOT NULL,
  samples           integer     NOT NULL,
  prev_fix_at       timestamptz,            -- the vessel's latest fix in the 6 h before first_at (any speed/place)
  prev_fix_at_port  boolean,                -- that fix was itself slow within 3 km of this port
  next_fix_at       timestamptz,            -- the vessel's earliest fix in the 6 h after last_at
  next_fix_at_port  boolean,
  PRIMARY KEY (mmsi, port_id, day, seq),
  CONSTRAINT port_call_days_order_check
    CHECK (last_at >= first_at AND samples >= 1 AND seq >= 1),
  CONSTRAINT port_call_days_inside_day_check
    CHECK (first_at >= (day::timestamp AT TIME ZONE 'UTC')
       AND last_at  <  ((day + 1)::timestamp AT TIME ZONE 'UTC')),
  CONSTRAINT port_call_days_evidence_check
    CHECK ((prev_fix_at IS NULL) = (prev_fix_at_port IS NULL)
       AND (next_fix_at IS NULL) = (next_fix_at_port IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_port_call_days_day      ON public.port_call_days (day);
CREATE INDEX IF NOT EXISTS idx_port_call_days_port_day ON public.port_call_days (port_id, day);

COMMENT ON TABLE public.port_call_days IS
  'Port-call atoms (mig 162): one vessel''s slow (< 0.5 kn) segment within 3 km of one port inside one UTC day, split on > 6 h gaps. The durable artefact the episodes in port_calls (derived_by = v2_day) are rolled up from; outlives the raw AIS history. Written only by derive_port_call_day().';

ALTER TABLE public.port_call_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.port_call_days FROM anon, authenticated;

-- ─── 3 · port_calls: generation + evidence ────────────────────────────────
ALTER TABLE public.port_calls
  ADD COLUMN IF NOT EXISTS derived_by         text,
  ADD COLUMN IF NOT EXISTS arrival_observed   boolean,
  ADD COLUMN IF NOT EXISTS departure_observed boolean,
  ADD COLUMN IF NOT EXISTS day_count          integer;

-- Guarded: touches only rows not yet labelled, so a re-run updates nothing.
UPDATE public.port_calls SET derived_by = 'v1_window' WHERE derived_by IS NULL;

ALTER TABLE public.port_calls ALTER COLUMN derived_by SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.port_calls'::regclass
                    AND conname = 'port_calls_derived_by_check') THEN
    ALTER TABLE public.port_calls
      ADD CONSTRAINT port_calls_derived_by_check CHECK (derived_by IN ('v1_window', 'v2_day'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.port_calls'::regclass
                    AND conname = 'port_calls_v2_shape_check') THEN
    ALTER TABLE public.port_calls
      ADD CONSTRAINT port_calls_v2_shape_check CHECK (
        derived_by <> 'v2_day'
        OR (    arrival_observed   IS NOT NULL
            AND departure_observed IS NOT NULL
            AND day_count >= 1
            AND departed_at IS NOT NULL
            AND departed_at >= arrived_at));
  END IF;
END $$;

-- Uniqueness is never absent: the new key exists before the old one is dropped.
CREATE UNIQUE INDEX IF NOT EXISTS port_calls_generation_key
  ON public.port_calls (mmsi, port_id, arrived_at, derived_by);
ALTER TABLE public.port_calls DROP CONSTRAINT IF EXISTS port_calls_mmsi_port_id_arrived_at_key;

-- The missing per-port index (build prompt §4.2), and the rebuild's window scan.
CREATE INDEX IF NOT EXISTS idx_port_calls_port_arrived
  ON public.port_calls (port_id, arrived_at);
CREATE INDEX IF NOT EXISTS idx_port_calls_v2_departed
  ON public.port_calls (departed_at) WHERE derived_by = 'v2_day';

COMMENT ON COLUMN public.port_calls.derived_by IS
  'v1_window = written by the retired 25 h-window derive_port_calls (mig 078): cron-boundary arrivals, accumulating sample_count, no coverage record — kept only for the founder''s day-by-day comparison. v2_day = rolled up from port_call_days by rebuild_port_calls (mig 162). Every consumer reads v2_day only.';
COMMENT ON COLUMN public.port_calls.arrival_observed IS
  'v2: true only when the vessel''s own previous fix within 6 h exists and was not slow within 3 km of this port. false = arrived_at is a lower bound (first seen already there). No rate may count a false. NULL = legacy v1 row.';
COMMENT ON COLUMN public.port_calls.departure_observed IS
  'v2: true only when the vessel''s own next fix within 6 h exists and was not slow within 3 km of this port. false = still there, or unseen. NULL = legacy v1 row.';
COMMENT ON COLUMN public.port_calls.departed_at IS
  'Last slow fix near the port. v2: never NULL (a single-fix call has departed_at = arrived_at); whether a departure was seen is departure_observed. v1: NULL meant a single sample so far.';

-- ─── 4 · Retire the API-called v1 derivation ──────────────────────────────
-- Same signature and return type, so CREATE OR REPLACE keeps its grants
-- (service_role only, mig 143). It writes nothing now.
CREATE OR REPLACE FUNCTION public.derive_port_calls(p_since timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'derive_port_calls(timestamptz) is retired by migration 162: port calls are derived per UTC day on pg_cron by derive_port_calls_due(); nothing may call the derivation over the API (PostgREST statement_timeout is 8 s)'
    USING ERRCODE = 'feature_not_supported';
END;
$$;

COMMENT ON FUNCTION public.derive_port_calls(timestamptz) IS
  'RETIRED (mig 162). Raises. Replaced by derive_port_calls_due() on pg_cron.';

-- ─── 5 · Roll atoms up into episodes ───────────────────────────────────────
-- Rebuilds every v2 episode touching [p_from − 1, p_to + 1] (± 6 h). For each
-- affected (mmsi, port_id) the scan widens to the full extent of the stored
-- episodes that touch the window, so an island is always recomputed whole.
-- Invariant that makes the widening sufficient: every atom belongs to a
-- stored v2 episode, because derive_port_call_day() calls this for its own day
-- in the same transaction.
CREATE OR REPLACE FUNCTION public.rebuild_port_calls(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lo_ts    timestamptz;
  v_hi_ts    timestamptz;
  v_pairs    integer;
  v_islands  integer;
  v_deleted  integer;
  v_written  integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'rebuild_port_calls: need p_from <= p_to (got %, %)', p_from, p_to;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('eykon.port_call_derivation'));

  v_lo_ts := ((p_from - 1)::timestamp AT TIME ZONE 'UTC') - interval '6 hours';
  v_hi_ts := ((p_to   + 2)::timestamp AT TIME ZONE 'UTC') + interval '6 hours';

  WITH pairs AS (
    SELECT a.mmsi, a.port_id
      FROM port_call_days a
     WHERE a.day BETWEEN p_from - 2 AND p_to + 2
       AND a.last_at >= v_lo_ts AND a.first_at <= v_hi_ts
    UNION
    SELECT pc.mmsi, pc.port_id
      FROM port_calls pc
     WHERE pc.derived_by = 'v2_day'
       AND pc.departed_at >= v_lo_ts AND pc.arrived_at <= v_hi_ts
  ),
  bounds AS (
    SELECT pr.mmsi, pr.port_id,
           LEAST(v_lo_ts, min(pc.arrived_at))     AS lo_ts,   -- LEAST/GREATEST ignore NULL
           GREATEST(v_hi_ts, max(pc.departed_at)) AS hi_ts
      FROM pairs pr
      LEFT JOIN port_calls pc
        ON pc.derived_by = 'v2_day'
       AND pc.mmsi = pr.mmsi AND pc.port_id = pr.port_id
       AND pc.departed_at >= v_lo_ts AND pc.arrived_at <= v_hi_ts
     GROUP BY pr.mmsi, pr.port_id
  ),
  atoms AS (
    SELECT a.*
      FROM bounds b
      JOIN port_call_days a
        ON a.mmsi = b.mmsi AND a.port_id = b.port_id
       AND a.day BETWEEN (b.lo_ts AT TIME ZONE 'UTC')::date AND (b.hi_ts AT TIME ZONE 'UTC')::date
       AND a.last_at >= b.lo_ts AND a.first_at <= b.hi_ts
  ),
  flagged AS (
    SELECT x.*,
           CASE WHEN lag(x.last_at) OVER w IS NULL
                  OR x.first_at - lag(x.last_at) OVER w > interval '6 hours'
                THEN 1 ELSE 0 END AS brk
      FROM atoms x
    WINDOW w AS (PARTITION BY x.mmsi, x.port_id ORDER BY x.first_at, x.day, x.seq)
  ),
  grouped AS (
    SELECT f.*,
           sum(f.brk) OVER (PARTITION BY f.mmsi, f.port_id
                            ORDER BY f.first_at, f.day, f.seq
                            ROWS UNBOUNDED PRECEDING) AS island
      FROM flagged f
  ),
  islands AS (
    SELECT g.mmsi, g.port_id,
           min(g.first_at)                AS arrived_at,
           max(g.last_at)                 AS departed_at,
           sum(g.samples)::integer        AS sample_count,
           count(DISTINCT g.day)::integer AS day_count,
           (array_agg(g.prev_fix_at IS NOT NULL AND g.prev_fix_at_port IS FALSE
                      ORDER BY g.first_at, g.day, g.seq))[1]                  AS arrival_observed,
           (array_agg(g.next_fix_at IS NOT NULL AND g.next_fix_at_port IS FALSE
                      ORDER BY g.last_at DESC, g.day DESC, g.seq DESC))[1]   AS departure_observed
      FROM grouped g
     GROUP BY g.mmsi, g.port_id, g.island
  ),
  named AS (
    SELECT i.*, p.port_name
      FROM islands i
      LEFT JOIN ports p ON p.id = i.port_id
  ),
  del AS (
    DELETE FROM port_calls pc
     USING bounds b
     WHERE pc.derived_by = 'v2_day'
       AND pc.mmsi = b.mmsi AND pc.port_id = b.port_id
       AND pc.departed_at >= b.lo_ts AND pc.arrived_at <= b.hi_ts
       AND NOT EXISTS (SELECT 1 FROM islands i
                        WHERE i.mmsi = pc.mmsi AND i.port_id = pc.port_id
                          AND i.arrived_at = pc.arrived_at)
    RETURNING 1
  ),
  ins AS (
    INSERT INTO port_calls AS pc
      (mmsi, port_id, port_name, arrived_at, departed_at, sample_count,
       day_count, arrival_observed, departure_observed, derived_by)
    SELECT n.mmsi, n.port_id, n.port_name, n.arrived_at, n.departed_at, n.sample_count,
           n.day_count, n.arrival_observed, n.departure_observed, 'v2_day'
      FROM named n
    ON CONFLICT (mmsi, port_id, arrived_at, derived_by) DO UPDATE
      SET port_name          = EXCLUDED.port_name,
          departed_at        = EXCLUDED.departed_at,
          sample_count       = EXCLUDED.sample_count,
          day_count          = EXCLUDED.day_count,
          arrival_observed   = EXCLUDED.arrival_observed,
          departure_observed = EXCLUDED.departure_observed
      WHERE (pc.port_name, pc.departed_at, pc.sample_count, pc.day_count,
             pc.arrival_observed, pc.departure_observed)
            IS DISTINCT FROM
            (EXCLUDED.port_name, EXCLUDED.departed_at, EXCLUDED.sample_count, EXCLUDED.day_count,
             EXCLUDED.arrival_observed, EXCLUDED.departure_observed)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM bounds), (SELECT count(*) FROM islands),
         (SELECT count(*) FROM del),    (SELECT count(*) FROM ins)
    INTO v_pairs, v_islands, v_deleted, v_written;

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'pairs', v_pairs,
                            'islands', v_islands, 'deleted', v_deleted, 'written', v_written);
END;
$$;

COMMENT ON FUNCTION public.rebuild_port_calls(date, date) IS
  'Rolls port_call_days atoms into port_calls episodes (derived_by = v2_day) for the islands touching [from-1, to+1]. Idempotent: a re-run deletes and writes nothing. Heavy over a long range — call from pg_cron or the SQL Editor, never over the API (mig 162).';

-- ─── 6 · Derive one UTC day ───────────────────────────────────────────────
-- The spatial predicate is unchanged from mig 078 (speed < 0.5 kn, within
-- 3,000 m of a WPI port, geography ST_DWithin on the GiST-indexed ports.geom):
-- this changes when and how the derivation runs, not what it claims to see.
CREATE OR REPLACE FUNCTION public.derive_port_call_day(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_t0         timestamptz := clock_timestamp();
  v_start      timestamptz;
  v_end        timestamptz;
  v_pruned     timestamptz;
  v_scanned    integer;
  v_slow       integer;
  v_live       integer;
  v_atoms      integer := 0;
  v_near       integer := 0;
  v_vdays      integer := 0;
  v_ports      integer := 0;
  v_refreshed  integer := 0;
  v_rebuild    jsonb;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'derive_port_call_day: p_day is required';
  END IF;

  -- One writer at a time: due(), this function, rebuild and prune share the key.
  PERFORM pg_advisory_xact_lock(hashtext('eykon.port_call_derivation'));

  -- GUARD: a day whose raw history is gone cannot be re-derived — the scan
  -- would find nothing and erase the day's atoms. Checked first, always.
  SELECT r.raw_pruned_at INTO v_pruned
    FROM port_call_derivation_runs r WHERE r.day = p_day;
  IF v_pruned IS NOT NULL THEN
    RETURN jsonb_build_object('day', p_day, 'skipped', 'raw_pruned', 'raw_pruned_at', v_pruned);
  END IF;

  IF p_day < port_call_first_day() OR p_day >= v_today THEN
    RAISE EXCEPTION 'derive_port_call_day: % is outside the derivable span [%, %) — only completed UTC days inside the sampler span',
      p_day, port_call_first_day(), v_today;
  END IF;

  v_start := p_day::timestamp AT TIME ZONE 'UTC';
  v_end   := (p_day + 1)::timestamp AT TIME ZONE 'UTC';

  SELECT count(*)::integer,
         (count(*) FILTER (WHERE speed IS NOT NULL AND speed < 0.5
                             AND latitude IS NOT NULL AND longitude IS NOT NULL))::integer,
         count(DISTINCT date_trunc('hour', recorded_at AT TIME ZONE 'UTC'))::integer
    INTO v_scanned, v_slow, v_live
    FROM ais_position_history
   WHERE recorded_at >= v_start AND recorded_at < v_end;

  -- Re-derivation is a replacement, never an accumulation.
  DELETE FROM port_call_days WHERE day = p_day;

  IF v_scanned = 0 THEN
    v_rebuild := rebuild_port_calls(p_day, p_day);
    INSERT INTO port_call_derivation_runs AS r
      (day, status, samples_scanned, slow_samples, near_samples, atoms, vessel_days,
       ports_touched, live_hours, duration_ms, error, ran_at)
    VALUES (p_day, 'samples_absent', 0, 0, 0, 0, 0, 0, 0,
            (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer, NULL, now())
    ON CONFLICT (day) DO UPDATE
      SET status = EXCLUDED.status, samples_scanned = 0, slow_samples = 0, near_samples = 0,
          atoms = 0, vessel_days = 0, ports_touched = 0, live_hours = 0,
          duration_ms = EXCLUDED.duration_ms, error = NULL, ran_at = EXCLUDED.ran_at;
    RETURN jsonb_build_object('day', p_day, 'status', 'samples_absent', 'rebuild', v_rebuild);
  END IF;

  WITH slow AS (
    SELECT h.mmsi, h.recorded_at, h.longitude, h.latitude
      FROM ais_position_history h
     WHERE h.recorded_at >= v_start AND h.recorded_at < v_end
       AND h.speed IS NOT NULL AND h.speed < 0.5
       AND h.longitude IS NOT NULL AND h.latitude IS NOT NULL
  ),
  near AS (
    SELECT s.mmsi, p.id AS port_id, s.recorded_at
      FROM slow s
      JOIN ports p
        ON ST_DWithin(p.geom,
                      ST_SetSRID(ST_MakePoint(s.longitude, s.latitude), 4326)::geography,
                      3000)
  ),
  flagged AS (
    SELECT n.*,
           CASE WHEN lag(n.recorded_at) OVER w IS NULL
                  OR n.recorded_at - lag(n.recorded_at) OVER w > interval '6 hours'
                THEN 1 ELSE 0 END AS brk
      FROM near n
    WINDOW w AS (PARTITION BY n.mmsi, n.port_id ORDER BY n.recorded_at)
  ),
  segs AS (
    SELECT f.mmsi, f.port_id, f.recorded_at,
           sum(f.brk) OVER (PARTITION BY f.mmsi, f.port_id ORDER BY f.recorded_at
                            ROWS UNBOUNDED PRECEDING) AS seq
      FROM flagged f
  ),
  atoms AS (
    SELECT s.mmsi, s.port_id, s.seq::integer AS seq,
           min(s.recorded_at) AS first_at, max(s.recorded_at) AS last_at,
           count(*)::integer AS samples
      FROM segs s
     GROUP BY s.mmsi, s.port_id, s.seq
  )
  INSERT INTO port_call_days
    (mmsi, port_id, day, seq, first_at, last_at, samples,
     prev_fix_at, prev_fix_at_port, next_fix_at, next_fix_at_port)
  SELECT a.mmsi, a.port_id, p_day, a.seq, a.first_at, a.last_at, a.samples,
         pf.recorded_at,
         CASE WHEN pf.recorded_at IS NULL THEN NULL
              ELSE (pf.speed < 0.5 AND ST_DWithin(p.geom,
                      ST_SetSRID(ST_MakePoint(pf.longitude, pf.latitude), 4326)::geography, 3000)) END,
         nf.recorded_at,
         CASE WHEN nf.recorded_at IS NULL THEN NULL
              ELSE (nf.speed < 0.5 AND ST_DWithin(p.geom,
                      ST_SetSRID(ST_MakePoint(nf.longitude, nf.latitude), 4326)::geography, 3000)) END
    FROM atoms a
    JOIN ports p ON p.id = a.port_id
    LEFT JOIN LATERAL (
      SELECT h.recorded_at, h.speed, h.latitude, h.longitude
        FROM ais_position_history h
       WHERE h.mmsi = a.mmsi
         AND h.recorded_at <  a.first_at
         AND h.recorded_at >= a.first_at - interval '6 hours'
         AND h.speed IS NOT NULL AND h.latitude IS NOT NULL AND h.longitude IS NOT NULL
       ORDER BY h.recorded_at DESC
       LIMIT 1
    ) pf ON true
    LEFT JOIN LATERAL (
      SELECT h.recorded_at, h.speed, h.latitude, h.longitude
        FROM ais_position_history h
       WHERE h.mmsi = a.mmsi
         AND h.recorded_at >  a.last_at
         AND h.recorded_at <= a.last_at + interval '6 hours'
         AND h.speed IS NOT NULL AND h.latitude IS NOT NULL AND h.longitude IS NOT NULL
       ORDER BY h.recorded_at ASC
       LIMIT 1
    ) nf ON true;
  GET DIAGNOSTICS v_atoms = ROW_COUNT;

  -- The previous day's late segments were derived before this day's raw
  -- history was complete; their departure evidence is final only now.
  -- Skipped when that day's raw history is already gone.
  IF NOT EXISTS (SELECT 1 FROM port_call_derivation_runs r
                  WHERE r.day = p_day - 1 AND r.raw_pruned_at IS NOT NULL) THEN
    WITH fresh AS (
      SELECT b.mmsi, b.port_id, b.day, b.seq,
             nf.recorded_at AS nf_at,
             CASE WHEN nf.recorded_at IS NULL THEN NULL
                  ELSE (nf.speed < 0.5 AND ST_DWithin(p.geom,
                          ST_SetSRID(ST_MakePoint(nf.longitude, nf.latitude), 4326)::geography, 3000)) END AS nf_at_port
        FROM port_call_days b
        JOIN ports p ON p.id = b.port_id
        LEFT JOIN LATERAL (
          SELECT h.recorded_at, h.speed, h.latitude, h.longitude
            FROM ais_position_history h
           WHERE h.mmsi = b.mmsi
             AND h.recorded_at >  b.last_at
             AND h.recorded_at <= b.last_at + interval '6 hours'
             AND h.speed IS NOT NULL AND h.latitude IS NOT NULL AND h.longitude IS NOT NULL
           ORDER BY h.recorded_at ASC
           LIMIT 1
        ) nf ON true
       WHERE b.day = p_day - 1
         AND b.last_at >= v_start - interval '6 hours'
    )
    UPDATE port_call_days a
       SET next_fix_at = f.nf_at, next_fix_at_port = f.nf_at_port
      FROM fresh f
     WHERE a.mmsi = f.mmsi AND a.port_id = f.port_id AND a.day = f.day AND a.seq = f.seq
       AND (a.next_fix_at, a.next_fix_at_port) IS DISTINCT FROM (f.nf_at, f.nf_at_port);
    GET DIAGNOSTICS v_refreshed = ROW_COUNT;
  END IF;

  -- Stats on the working set before the rollup plans against it.
  ANALYZE public.port_call_days;

  v_rebuild := rebuild_port_calls(p_day, p_day);

  SELECT count(DISTINCT (d.mmsi, d.port_id))::integer,
         count(DISTINCT d.port_id)::integer,
         COALESCE(sum(d.samples), 0)::integer
    INTO v_vdays, v_ports, v_near
    FROM port_call_days d
   WHERE d.day = p_day;

  INSERT INTO port_call_derivation_runs AS r
    (day, status, samples_scanned, slow_samples, near_samples, atoms, vessel_days,
     ports_touched, live_hours, duration_ms, error, ran_at)
  VALUES (p_day, 'derived', v_scanned, v_slow, v_near, v_atoms, v_vdays, v_ports, v_live,
          (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer, NULL, now())
  ON CONFLICT (day) DO UPDATE
    SET status = EXCLUDED.status, samples_scanned = EXCLUDED.samples_scanned,
        slow_samples = EXCLUDED.slow_samples, near_samples = EXCLUDED.near_samples,
        atoms = EXCLUDED.atoms, vessel_days = EXCLUDED.vessel_days,
        ports_touched = EXCLUDED.ports_touched, live_hours = EXCLUDED.live_hours,
        duration_ms = EXCLUDED.duration_ms, error = NULL, ran_at = EXCLUDED.ran_at;

  RETURN jsonb_build_object('day', p_day, 'status', 'derived', 'samples', v_scanned,
                            'live_hours', v_live, 'atoms', v_atoms, 'vessel_days', v_vdays,
                            'prev_day_evidence_refreshed', v_refreshed, 'rebuild', v_rebuild);
END;
$$;

COMMENT ON FUNCTION public.derive_port_call_day(date) IS
  'Derives one completed UTC day of port-call atoms from ais_position_history, then rebuilds the episodes touching it. ~15–20 s for a post-2026-08-24 day: pg_cron or the SQL Editor only, never over the API (mig 162). Refuses a day whose raw history was pruned.';

-- ─── 7 · The pg_cron entry point ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.derive_port_calls_due(
  p_max_days  integer DEFAULT 3,
  p_budget_ms integer DEFAULT 60000
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_yesterday  date := (now() AT TIME ZONE 'UTC')::date - 1;
  v_t0         timestamptz := clock_timestamp();
  v_day        date;
  v_res        jsonb;
  v_err        text;
  v_out        jsonb := '[]'::jsonb;
  v_remaining  integer;
  v_budgeted   boolean := false;
BEGIN
  IF p_max_days IS NULL OR p_max_days < 1 OR p_max_days > 10 THEN
    RAISE EXCEPTION 'derive_port_calls_due: p_max_days must be between 1 and 10 (got %)', p_max_days;
  END IF;
  IF p_budget_ms IS NULL OR p_budget_ms < 1000 OR p_budget_ms > 90000 THEN
    RAISE EXCEPTION 'derive_port_calls_due: p_budget_ms must be between 1000 and 90000 (got %)', p_budget_ms;
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('eykon.port_call_derivation')) THEN
    RETURN jsonb_build_object('skipped', 'another port-call derivation holds the lock');
  END IF;

  FOR v_day IN
    SELECT s.day
      FROM (SELECT gs::date AS day
              FROM generate_series(port_call_first_day()::timestamp, v_yesterday::timestamp, interval '1 day') gs) s
      LEFT JOIN port_call_derivation_runs r ON r.day = s.day
     WHERE r.day IS NULL OR r.status = 'failed'
     ORDER BY (s.day = v_yesterday) DESC, s.day ASC
     LIMIT p_max_days
  LOOP
    -- Time budget: a post-2026-08-24 day takes ~15–20 s, and the whole call
    -- must finish inside the 120 s database statement_timeout, or every day
    -- in it rolls back. No new day starts once the budget is spent.
    IF clock_timestamp() - v_t0 > make_interval(secs => p_budget_ms / 1000.0) THEN
      v_budgeted := true;
      EXIT;
    END IF;
    BEGIN
      v_res := derive_port_call_day(v_day);
    EXCEPTION WHEN OTHERS THEN
      -- The failed day's writes roll back with this block; the failure is recorded.
      v_err := SQLERRM;
      INSERT INTO port_call_derivation_runs AS r (day, status, error, ran_at)
      VALUES (v_day, 'failed', v_err, now())
      ON CONFLICT (day) DO UPDATE
        SET error = EXCLUDED.error, ran_at = EXCLUDED.ran_at
        WHERE r.status = 'failed';            -- never downgrade a derived day
      v_res := jsonb_build_object('day', v_day, 'status', 'failed', 'error', v_err);
    END;
    v_out := v_out || jsonb_build_array(v_res);
  END LOOP;

  SELECT count(*)::integer INTO v_remaining
    FROM generate_series(port_call_first_day()::timestamp, v_yesterday::timestamp, interval '1 day') gs
    LEFT JOIN port_call_derivation_runs r ON r.day = gs::date
   WHERE r.day IS NULL OR r.status = 'failed';

  RETURN jsonb_build_object('days', v_out, 'still_due', v_remaining, 'stopped_on_budget', v_budgeted,
                            'duration_ms', (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer);
END;
$$;

COMMENT ON FUNCTION public.derive_port_calls_due(integer, integer) IS
  'pg_cron entry point (job derive-port-calls, 00:17 and 12:17 UTC). Derives up to N completed UTC days with no run record or a failed one — yesterday first, then the backlog oldest-first — each in its own subtransaction, recording failures; starts no new day after p_budget_ms (default 60 s) so the call stays inside the 120 s statement_timeout. Also the founder''s backfill: SELECT public.derive_port_calls_due(5); repeated. Never over the API (mig 162).';

-- ─── 8 · Grants: the writers are service_role only (mig 143 rule) ────────
REVOKE EXECUTE ON FUNCTION public.derive_port_call_day(date)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rebuild_port_calls(date, date)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.derive_port_calls_due(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.derive_port_call_day(date)        TO service_role;
GRANT  EXECUTE ON FUNCTION public.rebuild_port_calls(date, date)    TO service_role;
GRANT  EXECUTE ON FUNCTION public.derive_port_calls_due(integer, integer) TO service_role;

-- ─── 9 · Schedule (unschedule-if-exists, then schedule) ──────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'derive-port-calls';
SELECT cron.schedule('derive-port-calls', '17 0,12 * * *',
                     $job$ SELECT public.derive_port_calls_due(3) $job$);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — paste these rows back. Every row must read ok = true.
-- ═══════════════════════════════════════════════════════════════════════════
WITH want_constraints(tbl, conname) AS (
  VALUES ('port_call_derivation_runs', 'port_call_derivation_runs_status_check'),
         ('port_call_derivation_runs', 'port_call_derivation_runs_shape_check'),
         ('port_call_derivation_runs', 'port_call_derivation_runs_pruned_check'),
         ('port_call_days',            'port_call_days_pkey'),
         ('port_call_days',            'port_call_days_order_check'),
         ('port_call_days',            'port_call_days_inside_day_check'),
         ('port_call_days',            'port_call_days_evidence_check'),
         ('port_calls',                'port_calls_derived_by_check'),
         ('port_calls',                'port_calls_v2_shape_check')
),
want_indexes(idx) AS (
  VALUES ('port_calls_generation_key'), ('idx_port_calls_port_arrived'),
         ('idx_port_calls_v2_departed'), ('idx_port_call_days_day'), ('idx_port_call_days_port_day')
),
want_functions(sig) AS (
  VALUES ('public.derive_port_call_day(date)'), ('public.rebuild_port_calls(date,date)'),
         ('public.derive_port_calls_due(integer,integer)')
)
SELECT 'table ' || t AS "check", to_regclass('public.' || t) IS NOT NULL AS ok, NULL::text AS detail
  FROM unnest(ARRAY['port_call_derivation_runs', 'port_call_days']) t
UNION ALL
SELECT 'constraint ' || w.conname, c.oid IS NOT NULL, pg_get_constraintdef(c.oid)
  FROM want_constraints w
  LEFT JOIN pg_constraint c
    ON c.conname = w.conname AND c.conrelid = to_regclass('public.' || w.tbl)
UNION ALL
SELECT 'index ' || w.idx, i.indexname IS NOT NULL, i.indexdef
  FROM want_indexes w
  LEFT JOIN pg_indexes i ON i.schemaname = 'public' AND i.indexname = w.idx
UNION ALL
SELECT 'old unique constraint dropped', NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'port_calls_mmsi_port_id_arrived_at_key'), NULL
UNION ALL
SELECT 'port_calls.' || col.column_name, true, col.data_type || ' · nullable ' || col.is_nullable
  FROM information_schema.columns col
 WHERE col.table_schema = 'public' AND col.table_name = 'port_calls'
   AND col.column_name IN ('derived_by', 'arrival_observed', 'departure_observed', 'day_count')
UNION ALL
SELECT 'legacy rows labelled v1_window (expect 88598, none unlabelled)',
       (SELECT count(*) FILTER (WHERE derived_by IS NULL) FROM public.port_calls) = 0,
       (SELECT count(*) FILTER (WHERE derived_by = 'v1_window') FROM public.port_calls)::text
UNION ALL
SELECT 'function ' || w.sig || ' (anon may not execute, service_role may)',
       to_regprocedure(w.sig) IS NOT NULL
       AND NOT has_function_privilege('anon', to_regprocedure(w.sig), 'EXECUTE')
       AND NOT has_function_privilege('authenticated', to_regprocedure(w.sig), 'EXECUTE')
       AND has_function_privilege('service_role', to_regprocedure(w.sig), 'EXECUTE'),
       NULL
  FROM want_functions w
UNION ALL
SELECT 'derive_port_calls(timestamptz) retired',
       (SELECT prosrc LIKE '%retired by migration 162%' FROM pg_proc
         WHERE oid = to_regprocedure('public.derive_port_calls(timestamp with time zone)')),
       NULL
UNION ALL
SELECT 'cron job derive-port-calls', j.active AND j.schedule = '17 0,12 * * *',
       j.schedule || ' · ' || j.command
  FROM cron.job j WHERE j.jobname = 'derive-port-calls'
UNION ALL
SELECT 'cron job derive-port-calls is unique', (SELECT count(*) FROM cron.job WHERE jobname = 'derive-port-calls') = 1, NULL;
