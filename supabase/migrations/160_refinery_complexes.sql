-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 160 · Refinery complexes: stable RFC- keys
--             (Reality Check programme, PR-1, guard 5 of §3.2; decision D-8)
--
-- PURPOSE
-- The unit of a Reality Check verdict is the COMPLEX, not the facility:
-- 142 of the 431 watched refineries have a watched neighbour inside 5 km,
-- and co-located sites duplicate one measurement. This migration creates
-- the registry that names complexes with keys that survive a refresh.
--
-- THE RULE (pinned; build prompt §3.1, §3.2, D-8)
--   * Linkage: single-linkage connected components on GEOGRAPHY at
--     5,000 m over the watched refineries. On 2026-09-18 that is 338
--     complexes over 431 watched refineries (largest: 13 members). The
--     published "343" came from a 0.045-degree DBSCAN in degrees.
--   * refineries.geom is GEOGRAPHY: distance tests run on geography;
--     collect/centroid run on geom::geometry.
--   * Watched = a refinery with a firms_facility_observations row in the
--     6 days ending at FIRMS's newest period (the same roster the Black
--     Marble worker samples).
--   * Keys: RFC-<lat_cell>-<lon_cell>-<seq>, minted from the FROZEN
--     centroid at first sight. Cells are whole degrees named by their
--     south-west corner (N31/S01, E047/W095); seq is the next integer in
--     that cell, never reused. Example: RFC-N31-E047-1.
--   * Re-match: a component re-uses the key of an active complex whose
--     frozen centroid lies within 2,500 m of the component's centroid —
--     never more than half the 5 km linkage, or two separate complexes
--     collapse onto one key. The frozen centroid is never updated (a
--     trigger refuses it). On 2026-09-18 the closest two component
--     centroids are 5,151 m apart, so every component re-matches exactly
--     one key.
--   * Membership continuity is also a candidate: an active complex that
--     shares a current member with the component. Without it a bridge
--     merge of two complexes more than 5 km apart (new centroid > 2.5 km
--     from both frozen centroids) would retire BOTH keys as dissolved and
--     mint a third, and "keep the earlier key" could never apply.
--   * Merge: a component with two or more candidate keys keeps the
--     EARLIER-minted key; the others are retired with
--     retired_reason = 'merged' and merged_into = the kept key. Voiding
--     open claims on a retired key is PR-5's job (no claims exist yet).
--   * Split: if two components claim one key, the component nearer its
--     frozen centroid keeps it; the other takes its next candidate or a
--     new key.
--   * A complex no component re-matches is retired as 'dissolved'.
--   * Connected-component and DBSCAN ordinals are never keys.
--
-- Rebuilt daily by pg_cron and seeded once when this file is applied.
-- The rebuild writes refinery_complex_runs on every call, even when it
-- changes nothing.
--
-- Idempotent. No temp tables, no session state. Apply MANUALLY in the
-- Supabase SQL Editor, the whole file, AFTER 159 and BEFORE merge.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1 · Key format (immutable; used by a CHECK) ───────────────────────
CREATE OR REPLACE FUNCTION public.refinery_complex_key(p_lat_cell integer, p_lon_cell integer, p_seq integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $function$
  SELECT 'RFC-'
      || CASE WHEN p_lat_cell >= 0 THEN 'N' || lpad(p_lat_cell::text, 2, '0')
              ELSE 'S' || lpad((-p_lat_cell)::text, 2, '0') END
      || '-'
      || CASE WHEN p_lon_cell >= 0 THEN 'E' || lpad(p_lon_cell::text, 3, '0')
              ELSE 'W' || lpad((-p_lon_cell)::text, 3, '0') END
      || '-' || p_seq::text
$function$;

COMMENT ON FUNCTION public.refinery_complex_key(integer, integer, integer) IS
  'RFC-<lat_cell>-<lon_cell>-<seq>. Cells are whole degrees named by their south-west corner: floor(lat), floor(lon). Mig 160.';

-- ─── 2 · The registry ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.refinery_complexes (
  cluster_key    text             PRIMARY KEY,
  lat_cell       integer          NOT NULL,
  lon_cell       integer          NOT NULL,
  seq            integer          NOT NULL,
  -- the centroid at mint, FROZEN (trigger below)
  centroid_lat   double precision NOT NULL,
  centroid_lon   double precision NOT NULL,
  centroid       geography(Point, 4326) NOT NULL,
  member_count   integer          NOT NULL,
  first_seen_at  timestamptz      NOT NULL DEFAULT now(),
  last_seen_at   timestamptz      NOT NULL DEFAULT now(),
  -- distance from the frozen centroid to the current component centroid
  -- at the last rebuild (information only; never moves the key)
  last_drift_m   double precision,
  retired_at     timestamptz,
  retired_reason text,
  merged_into    text REFERENCES public.refinery_complexes (cluster_key)
);

COMMENT ON TABLE public.refinery_complexes IS
  'Reality Check PR-1 (mig 160). One row per refinery complex ever minted: single-linkage on geography at 5,000 m over the watched refineries; key RFC-<lat_cell>-<lon_cell>-<seq> minted from the frozen centroid; re-matched within 2,500 m (or by a shared current member); merges keep the earlier key. Keys are never reused, updated or deleted.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfc_key_format') THEN
    ALTER TABLE public.refinery_complexes ADD CONSTRAINT rfc_key_format
      CHECK (cluster_key ~ '^RFC-[NS][0-9]{2}-[EW][0-9]{3}-[1-9][0-9]*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfc_key_matches_cell') THEN
    ALTER TABLE public.refinery_complexes ADD CONSTRAINT rfc_key_matches_cell
      CHECK (cluster_key = public.refinery_complex_key(lat_cell, lon_cell, seq) AND seq >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfc_cell_matches_centroid') THEN
    ALTER TABLE public.refinery_complexes ADD CONSTRAINT rfc_cell_matches_centroid
      CHECK (lat_cell = floor(centroid_lat)::integer AND lon_cell = floor(centroid_lon)::integer);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfc_cell_seq_unique') THEN
    ALTER TABLE public.refinery_complexes ADD CONSTRAINT rfc_cell_seq_unique UNIQUE (lat_cell, lon_cell, seq);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfc_member_count_sane') THEN
    ALTER TABLE public.refinery_complexes ADD CONSTRAINT rfc_member_count_sane
      CHECK (member_count >= 0 AND (retired_at IS NOT NULL OR member_count >= 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfc_retirement_consistent') THEN
    ALTER TABLE public.refinery_complexes ADD CONSTRAINT rfc_retirement_consistent
      CHECK ((retired_at IS NULL) = (retired_reason IS NULL)
             AND (retired_reason IS NULL OR retired_reason IN ('merged', 'dissolved'))
             AND ((coalesce(retired_reason, '') = 'merged') = (merged_into IS NOT NULL))
             AND merged_into IS DISTINCT FROM cluster_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS refinery_complexes_active_centroid_idx
  ON public.refinery_complexes USING gist (centroid) WHERE retired_at IS NULL;

-- Frozen means frozen: the key, its cell and its centroid never change, a
-- retired key never comes back, and no row is ever deleted.
CREATE OR REPLACE FUNCTION public.refinery_complexes_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refinery_complexes: % is a published key; retire it, never delete it', OLD.cluster_key
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.cluster_key   IS DISTINCT FROM OLD.cluster_key
     OR NEW.lat_cell     IS DISTINCT FROM OLD.lat_cell
     OR NEW.lon_cell     IS DISTINCT FROM OLD.lon_cell
     OR NEW.seq          IS DISTINCT FROM OLD.seq
     OR NEW.centroid_lat IS DISTINCT FROM OLD.centroid_lat
     OR NEW.centroid_lon IS DISTINCT FROM OLD.centroid_lon
     OR NOT ST_Equals(NEW.centroid::geometry, OLD.centroid::geometry)
     OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at THEN
    RAISE EXCEPTION 'refinery_complexes: the key and frozen centroid of % never change', OLD.cluster_key
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'refinery_complexes: % is retired; a retired key is never reused', OLD.cluster_key
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS refinery_complexes_frozen ON public.refinery_complexes;
CREATE TRIGGER refinery_complexes_frozen
  BEFORE UPDATE OR DELETE ON public.refinery_complexes
  FOR EACH ROW EXECUTE FUNCTION public.refinery_complexes_frozen();

-- ─── 3 · Membership: facility -> complex, with history ─────────────────
CREATE TABLE IF NOT EXISTS public.refinery_complex_members (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cluster_key  text        NOT NULL REFERENCES public.refinery_complexes (cluster_key),
  facility_id  text        NOT NULL REFERENCES public.refineries (id),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz,
  CONSTRAINT rfcm_left_after_joined CHECK (left_at IS NULL OR left_at >= joined_at)
);

COMMENT ON TABLE public.refinery_complex_members IS
  'Reality Check PR-1 (mig 160). Which refinery belongs to which complex, and since when. left_at IS NULL = current member; a facility has at most one current complex.';

-- one current complex per facility
CREATE UNIQUE INDEX IF NOT EXISTS refinery_complex_members_current_uq
  ON public.refinery_complex_members (facility_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS refinery_complex_members_key_idx
  ON public.refinery_complex_members (cluster_key) WHERE left_at IS NULL;

-- ─── 4 · Run record ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.refinery_complex_runs (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at             timestamptz NOT NULL DEFAULT now(),
  linkage_m          integer     NOT NULL,
  rematch_m          integer     NOT NULL,
  watched_facilities integer     NOT NULL,
  components         integer     NOT NULL,
  matched            integer     NOT NULL,
  minted             integer     NOT NULL,
  merged             integer     NOT NULL,
  dissolved          integer     NOT NULL,
  members_joined     integer     NOT NULL,
  members_left       integer     NOT NULL,
  duration_ms        integer     NOT NULL
);
COMMENT ON TABLE public.refinery_complex_runs IS
  'One row per rebuild_refinery_complexes() call, even when nothing changed. A rebuild on unchanged data reads minted 0, merged 0, dissolved 0, joined 0, left 0.';

ALTER TABLE public.refinery_complexes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refinery_complex_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refinery_complex_runs    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refinery_complexes       FROM anon, authenticated;
REVOKE ALL ON public.refinery_complex_members FROM anon, authenticated;
REVOKE ALL ON public.refinery_complex_runs    FROM anon, authenticated;

-- ─── 5 · The rebuild ───────────────────────────────────────────────────
-- Parameters are constants, not arguments: a different linkage under the
-- same key registry would silently re-define every complex. Changing them
-- is a migration and a ledger_change_log row (D-5).
CREATE OR REPLACE FUNCTION public.rebuild_refinery_complexes()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  c_linkage_m   CONSTANT integer := 5000;
  c_rematch_m   CONSTANT integer := 2500;
  c_watch_days  CONSTANT integer := 5;
  v_t0          timestamptz := clock_timestamp();
  v_now         timestamptz := now();
  v_newest      date;
  c             record;
  k             record;
  v_key         text;
  v_lat_cell    integer;
  v_lon_cell    integer;
  v_seq         integer;
  v_claimed     text[] := '{}';
  v_passed_over text[] := '{}';   -- candidate keys a component did not keep ...
  v_passed_into text[] := '{}';   -- ... and the key that component kept instead
  v_all_members text[] := '{}';
  v_idx         integer;
  v_n           integer;
  v_watched     integer := 0;
  v_components  integer := 0;
  v_matched     integer := 0;
  v_minted      integer := 0;
  v_merged      integer := 0;
  v_dissolved   integer := 0;
  v_joined      integer := 0;
  v_left        integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rebuild_refinery_complexes'));

  SELECT max(period) INTO v_newest FROM firms_facility_observations WHERE facility_type = 'refinery';
  IF v_newest IS NULL THEN
    RAISE EXCEPTION 'rebuild_refinery_complexes: no FIRMS refinery observations — the watched set is unknown, refusing to rebuild';
  END IF;

  SELECT count(DISTINCT f.facility_id) INTO v_watched
    FROM firms_facility_observations f
    JOIN refineries r ON r.id = f.facility_id AND r.geom IS NOT NULL
   WHERE f.facility_type = 'refinery'
     AND f.period BETWEEN v_newest - c_watch_days AND v_newest;

  FOR c IN
    WITH RECURSIVE
    watched AS (
      SELECT DISTINCT f.facility_id
        FROM firms_facility_observations f
       WHERE f.facility_type = 'refinery'
         AND f.period BETWEEN v_newest - c_watch_days AND v_newest
    ),
    node AS (
      SELECT r.id, r.geom
        FROM refineries r
        JOIN watched w ON w.facility_id = r.id
       WHERE r.geom IS NOT NULL
    ),
    edge AS (   -- geography distance, metres
      SELECT a.id AS src, b.id AS dst
        FROM node a
        JOIN node b ON a.id <> b.id AND ST_DWithin(a.geom, b.geom, c_linkage_m)
    ),
    reach (root, nd) AS (
      SELECT id, id FROM node
      UNION
      SELECT r.root, e.dst FROM reach r JOIN edge e ON e.src = r.nd
    ),
    comp AS (   -- the component representative only GROUPS; it never names
      SELECT nd AS facility_id, min(root) AS rep FROM reach GROUP BY nd
    ),
    grp AS (
      SELECT cp.rep,
             array_agg(n.id ORDER BY n.id)                  AS members,
             ST_Centroid(ST_Collect(n.geom::geometry))      AS g
        FROM comp cp
        JOIN node n ON n.id = cp.facility_id
       GROUP BY cp.rep
    ),
    cand AS (   -- positional re-match, or membership continuity (how a merge is seen)
      SELECT g.rep, rc.cluster_key, rc.first_seen_at,
             ST_Distance(rc.centroid, g.g::geography) AS d
        FROM grp g
        JOIN refinery_complexes rc
          ON rc.retired_at IS NULL
         AND (ST_DWithin(rc.centroid, g.g::geography, c_rematch_m)
              OR EXISTS (SELECT 1 FROM refinery_complex_members m
                          WHERE m.cluster_key = rc.cluster_key
                            AND m.left_at IS NULL
                            AND m.facility_id = ANY (g.members)))
    )
    SELECT g.rep, g.members, g.g,
           ST_Y(g.g) AS lat, ST_X(g.g) AS lon,
           (SELECT array_agg(x.cluster_key ORDER BY x.first_seen_at, x.cluster_key)
              FROM cand x WHERE x.rep = g.rep) AS candidates,
           (SELECT min(x.d) FROM cand x WHERE x.rep = g.rep) AS dmin
      FROM grp g
     ORDER BY dmin NULLS LAST, ST_Y(g.g), ST_X(g.g), g.rep
  LOOP
    v_components := v_components + 1;
    v_all_members := v_all_members || c.members;

    -- keep the earliest-minted candidate no other component has claimed
    v_key := NULL;
    IF c.candidates IS NOT NULL THEN
      SELECT u.k INTO v_key
        FROM unnest(c.candidates) WITH ORDINALITY AS u(k, o)
       WHERE NOT (u.k = ANY (v_claimed))
       ORDER BY u.o
       LIMIT 1;
    END IF;

    IF v_key IS NULL THEN
      v_lat_cell := floor(c.lat)::integer;
      v_lon_cell := floor(c.lon)::integer;
      SELECT coalesce(max(rc.seq), 0) + 1 INTO v_seq
        FROM refinery_complexes rc
       WHERE rc.lat_cell = v_lat_cell AND rc.lon_cell = v_lon_cell;
      v_key := refinery_complex_key(v_lat_cell, v_lon_cell, v_seq);
      INSERT INTO refinery_complexes
        (cluster_key, lat_cell, lon_cell, seq, centroid_lat, centroid_lon, centroid,
         member_count, first_seen_at, last_seen_at, last_drift_m)
      VALUES
        (v_key, v_lat_cell, v_lon_cell, v_seq, c.lat, c.lon, c.g::geography,
         cardinality(c.members), v_now, v_now, 0);
      v_minted := v_minted + 1;
    ELSE
      UPDATE refinery_complexes rc
         SET last_seen_at = v_now,
             member_count = cardinality(c.members),
             last_drift_m = ST_Distance(rc.centroid, c.g::geography)
       WHERE rc.cluster_key = v_key;
      v_matched := v_matched + 1;
      -- the other candidates of this component, if nobody else keeps them,
      -- are merged into v_key after the loop
      SELECT v_passed_over || coalesce(array_agg(u.k), '{}'),
             v_passed_into || coalesce(array_agg(v_key), '{}')
        INTO v_passed_over, v_passed_into
        FROM unnest(c.candidates) AS u(k)
       WHERE u.k <> v_key;
    END IF;
    v_claimed := v_claimed || v_key;

    -- membership: close a current membership elsewhere, open one here
    UPDATE refinery_complex_members m
       SET left_at = v_now
     WHERE m.left_at IS NULL
       AND m.facility_id = ANY (c.members)
       AND m.cluster_key <> v_key;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_left := v_left + v_n;

    INSERT INTO refinery_complex_members (cluster_key, facility_id, joined_at)
    SELECT v_key, mbr, v_now
      FROM unnest(c.members) AS mbr
     WHERE NOT EXISTS (SELECT 1 FROM refinery_complex_members x
                        WHERE x.facility_id = mbr AND x.left_at IS NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_joined := v_joined + v_n;
  END LOOP;

  -- facilities no longer watched leave their complex
  UPDATE refinery_complex_members m
     SET left_at = v_now
   WHERE m.left_at IS NULL
     AND NOT (m.facility_id = ANY (v_all_members));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_left := v_left + v_n;

  -- active keys nobody kept: merged (into the key their component kept) or dissolved
  FOR k IN
    SELECT rc.cluster_key
      FROM refinery_complexes rc
     WHERE rc.retired_at IS NULL
       AND NOT (rc.cluster_key = ANY (v_claimed))
     ORDER BY rc.cluster_key
  LOOP
    v_idx := array_position(v_passed_over, k.cluster_key);
    IF v_idx IS NOT NULL THEN
      UPDATE refinery_complexes
         SET retired_at = v_now, retired_reason = 'merged',
             merged_into = v_passed_into[v_idx], member_count = 0
       WHERE cluster_key = k.cluster_key;
      v_merged := v_merged + 1;
    ELSE
      UPDATE refinery_complexes
         SET retired_at = v_now, retired_reason = 'dissolved', member_count = 0
       WHERE cluster_key = k.cluster_key;
      v_dissolved := v_dissolved + 1;
    END IF;
    UPDATE refinery_complex_members
       SET left_at = v_now
     WHERE cluster_key = k.cluster_key AND left_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_left := v_left + v_n;
  END LOOP;

  INSERT INTO refinery_complex_runs
    (linkage_m, rematch_m, watched_facilities, components, matched, minted, merged,
     dissolved, members_joined, members_left, duration_ms)
  VALUES
    (c_linkage_m, c_rematch_m, v_watched, v_components, v_matched, v_minted, v_merged,
     v_dissolved, v_joined, v_left,
     (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);

  RETURN jsonb_build_object(
    'watched_facilities', v_watched,
    'components',         v_components,
    'matched',            v_matched,
    'minted',             v_minted,
    'merged',             v_merged,
    'dissolved',          v_dissolved,
    'members_joined',     v_joined,
    'members_left',       v_left,
    'linkage_m',          c_linkage_m,
    'rematch_m',          c_rematch_m,
    'duration_ms',        (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);
END;
$function$;

COMMENT ON FUNCTION public.rebuild_refinery_complexes() IS
  'Reality Check PR-1 (mig 160). Single-linkage on geography at 5,000 m over the watched refineries; re-matches each component to an active RFC- key within 2,500 m of its frozen centroid or sharing a current member (earliest-minted wins a merge; the component nearer the frozen centroid wins a split), mints new keys otherwise, retires keys nobody keeps. Writes refinery_complex_runs on every call. pg_cron only.';

REVOKE EXECUTE ON FUNCTION public.rebuild_refinery_complexes() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rebuild_refinery_complexes() TO service_role;
REVOKE EXECUTE ON FUNCTION public.refinery_complexes_frozen() FROM PUBLIC, anon, authenticated;

-- ─── 6 · Schedule + seed ───────────────────────────────────────────────
-- Daily 03:20 UTC: clear of the 01:37 FIRMS/port-call collision window,
-- the :05/:12/:50 night-lights, plan and census jobs, and the 09:44 BM run.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'rebuild-refinery-complexes';
SELECT cron.schedule('rebuild-refinery-complexes', '20 3 * * *',
                     $job$ SELECT public.rebuild_refinery_complexes() $job$);

-- First call mints every key (338 on 2026-09-18); any re-run re-matches them.
SELECT public.rebuild_refinery_complexes();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only. Paste these rows back.
-- ═══════════════════════════════════════════════════════════════════════

-- V1 · objects exist (expect every present = true)
SELECT 'table refinery_complexes'              AS object, to_regclass('public.refinery_complexes')       IS NOT NULL AS present
UNION ALL SELECT 'table refinery_complex_members', to_regclass('public.refinery_complex_members') IS NOT NULL
UNION ALL SELECT 'table refinery_complex_runs',    to_regclass('public.refinery_complex_runs')    IS NOT NULL
UNION ALL SELECT 'function rebuild_refinery_complexes()',
                 to_regprocedure('public.rebuild_refinery_complexes()') IS NOT NULL
UNION ALL SELECT 'function refinery_complex_key(int,int,int)',
                 to_regprocedure('public.refinery_complex_key(integer,integer,integer)') IS NOT NULL
UNION ALL SELECT 'constraint rfc_key_matches_cell',
                 EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfc_key_matches_cell')
UNION ALL SELECT 'constraint rfc_retirement_consistent',
                 EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfc_retirement_consistent')
UNION ALL SELECT 'trigger refinery_complexes_frozen',
                 EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'refinery_complexes_frozen' AND NOT tgisinternal)
UNION ALL SELECT 'index refinery_complex_members_current_uq',
                 to_regclass('public.refinery_complex_members_current_uq') IS NOT NULL
UNION ALL SELECT 'cron job rebuild-refinery-complexes',
                 EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rebuild-refinery-complexes' AND active)
UNION ALL SELECT 'anon cannot execute rebuild',
                 NOT has_function_privilege('anon', 'public.rebuild_refinery_complexes()', 'EXECUTE');

-- V2 · the registry (2026-09-18 expectation: active 338 · members 431 ·
--      with a neighbour 142 · largest 13 · retired 0)
SELECT count(*) FILTER (WHERE retired_at IS NULL)                         AS active_complexes,
       count(*) FILTER (WHERE retired_at IS NOT NULL)                     AS retired_complexes,
       (SELECT count(*) FROM public.refinery_complex_members WHERE left_at IS NULL) AS current_members,
       (SELECT count(*) FROM public.refinery_complex_members m
         WHERE m.left_at IS NULL
           AND (SELECT count(*) FROM public.refinery_complex_members x
                 WHERE x.cluster_key = m.cluster_key AND x.left_at IS NULL) > 1) AS members_with_a_neighbour,
       max(member_count)                                                   AS largest_complex
  FROM public.refinery_complexes;

-- V3 · the run records (expect the seed run: minted = components = 338,
--      matched 0; any later re-run: minted 0, merged 0, dissolved 0)
SELECT ran_at, watched_facilities, components, matched, minted, merged, dissolved,
       members_joined, members_left, duration_ms
  FROM public.refinery_complex_runs
 ORDER BY ran_at DESC
 LIMIT 3;

-- V4 · five largest complexes, for eyeballing
SELECT c.cluster_key, c.member_count, round(c.centroid_lat::numeric, 4) AS lat,
       round(c.centroid_lon::numeric, 4) AS lon,
       string_agg(coalesce(r.refinery_name, r.id), ' / ' ORDER BY r.id) AS members
  FROM public.refinery_complexes c
  JOIN public.refinery_complex_members m ON m.cluster_key = c.cluster_key AND m.left_at IS NULL
  JOIN public.refineries r ON r.id = m.facility_id
 WHERE c.retired_at IS NULL
 GROUP BY 1, 2, 3, 4
 ORDER BY c.member_count DESC, c.cluster_key
 LIMIT 5;
