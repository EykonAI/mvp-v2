-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 169 · Reality Check detector support: the refinery population,
--             the tick's read surface, a verdict for a dual-down complex the
--             stability test cannot check, and the claim families' monitor
--             (Reality Check programme, PR-5, file 1 of 2; D-7, D-8, D-14, §3.1, §3.5)
--
-- WHAT THIS FILE DOES
--   1. rebuild_refinery_complexes() and its watched set filter
--      refineries.site_type = 'refinery' (mig 168). A re-typed site
--      (terminal, petrochemical, ethanol, gas plant, upstream, other) neither
--      forms nor joins a complex. Everything else in the function is mig 160
--      verbatim. The rebuild runs once at the end of this file.
--   2. reality_check_runs gains ks_split_rule (CHECK-pinned), bm_nights_used /
--      firms_days_used (the usable nights a tick read: a later difference is
--      what makes a superseding tick) and claims_issued, plus one live run per
--      (asset, data clock, superseded run).
--   3. The verdict table's coverage CHECK admits ONE more row shape (below).
--   4. reality_check_tick_inputs(from, to): the TypeScript tick's single read,
--      one row per active complex with its per-night MEDIANS (from the mig-161
--      view) and heat days. Read-only; ~300 rows; no classification in SQL.
--   5. refinery_rc_walkforward(): the monitor for the four claim families
--      (mig-152 pattern: recomputed on every read), a ledger_watch_prove kind
--      for it, and a seeded watch item.
--   6. A ledger_change_log row for the method changes in 1 and 3.
--
-- ─── 1 · WHAT HAPPENS TO THE KEYS (measured read-only 2026-09-19) ─────────
-- The live registry (seed run 2026-09-19 08:03 UTC) holds 338 active keys over
-- 431 members, 96 of them re-typed by mig 168. Under the site_type filter the
-- watched set is 353 rows (335 of the 431 + the 16 strike-claim inserts, Omsk
-- and one more site the widened ru-ua box took in) in 295 components:
--   · 264 complexes have no re-typed member          → re-matched, unchanged
--   ·  15 complexes lose some members to re-typing   → keep their key through
--        membership continuity (a shared current member; the largest centroid
--        drift is 2,668 m, just past the 2,500 m positional re-match)
--   ·  59 complexes whose members are ALL re-typed   → retired 'dissolved'
--        (mig 160's rule for a key no component re-matches). Never deleted;
--        the frozen-row trigger forbids it. No claim exists on any of them.
--   ·  16 new components (the 18 new rows: TANECO + TAIF-NK and UNPZ + Novoil
--        are one complex each) → minted — or already minted by the 03:20 UTC
--        run of the old function if that ran before this file.
--   No split, no merge, no contested key. Members: 96 leave, 18 join.
-- Claims on a retired key are VOID at resolution (build prompt §3.2: "void
-- every open claim on the retired key") — the resolver in mig 170 does it.
--
-- ─── 3 · THE ONE NEW VERDICT SHAPE, AND WHY ───────────────────────────────
-- §3.1: "Below 12 baseline nights ks_tested = false, and the complex may be
-- REFUTED or STEADY, never LEAD." A complex whose heat AND light are both
-- down with 5–11 baseline nights therefore has no verdict mig 161 accepts:
-- not LEAD (rcsv_lead_needs_ks_test), not REFUTED/STEADY (light is down),
-- not LIGHT_DOWN_ONLY (heat is down), not VOID_BASELINE_UNSTABLE (no failed
-- test), not VOID_INSUFFICIENT_NIGHTS (coverage is OBSERVED). Every CHECK
-- holds, so the insert fails and the whole tick with it. It happens on the
-- FIRST real tick: Raffinerie de Donges, data clock 2026-09-08 — heat 10/31
-- baseline days → 2/15, median radiance 98.72 → 32.23 (0.326), 11 baseline
-- nights. The conservative reading of §3.1 is a VOID: the stability test is
-- the lead's floor, and below it there are not enough nights to call one.
-- So rcsv_coverage_voids now also admits VOID_INSUFFICIENT_NIGHTS on an
-- OBSERVED row exactly when ks_tested is false, heat_state = HEAT_DOWN and
-- light is down; everything else it bound is bound as before (a BELOW_FLOOR
-- row is still always VOID_INSUFFICIENT_NIGHTS, NOT_OBSERVED ⇔
-- VOID_NOT_OBSERVED). No threshold, window or column changes.
--
-- ─── THE STABILITY TEST (pinned here as ks_split_rule) ────────────────────
-- lib/intel/ks.ts ksStatistic / ksPValue on the complex's per-night median
-- radiance over the BASELINE's usable nights, split by count: the first
-- ⌊n/2⌋ nights (by date) against the rest; run only at n >= 12; failed at
-- p < 0.05. The 3x3 robustness verdict re-runs the same ladder on
-- radiance_3x3 (px_hq_3x3 >= 5) with the primary's heat state and the
-- primary's stability result — it swaps the light statistic, nothing else.
-- Measured on the first-tick windows (baseline 2026-07-18..08-17, window
-- 08-18..09-01): 14 of 312 observed facility rows fail the test, none of the
-- 12 thermally dark ones; the facility funnel reproduces 312 → 125 → 12 →
-- 11 refuted + 1 lead exactly, and 309 → 123 → 12 → 12 + 0 on 3x3.
--
-- ─── 5 · THE MONITOR (D-7) ────────────────────────────────────────────────
-- Per family: issued, judged (scored, non-VOID), k, void, open, base rate,
-- Brier, hit rate, walk-forward skill overall and in each half (halves by
-- issue order), the next claim's p = (k + 20 x 0.5) / (n + 20), and a status:
--   calibrating — fewer than 90 judged, OR skill undefined in a half (a half
--                 with base rate 0 or 1: the near-certain family's normal
--                 state). Never suspended or promoted on an undefined score.
--   suspended   — >= 90 judged, skill defined in both halves, negative in
--                 both. The issuer stops issuing that family.
--   scored      — otherwise.
-- Every family counts in the machine-track headline (founder, rev H): there
-- is no base-rate exclusion anywhere in this file.
--
-- Heavy SQL: none. The rebuild takes ~0.9 s (pg_cron job unchanged, 03:20
-- UTC); the tick read measured ~50 ms; the monitor reads refinery-rc claims
-- only (index on source).
--
-- Idempotent: CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS, constraint
-- guards, NOT EXISTS inserts. No temp tables, no session state.
-- Apply MANUALLY in the Supabase SQL Editor, the whole file, AFTER 168 and
-- BEFORE 170, BEFORE merge. Paste back the VERIFY rows (one SELECT, last).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1 · The population: site_type = 'refinery' only ───────────────────
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
                            AND r.site_type = 'refinery'   -- mig 169: re-typed sites are not in the population
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
         AND r.site_type = 'refinery'   -- mig 169: re-typed sites neither form nor join a complex
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
  'Reality Check PR-1 (mig 160), population filtered by mig 169: single-linkage on geography at 5,000 m over the watched refineries with site_type = ''refinery'' (re-typed sites neither form nor join a complex); re-matches each component to an active RFC- key within 2,500 m of its frozen centroid or sharing a current member (earliest-minted wins a merge; the component nearer the frozen centroid wins a split), mints new keys otherwise, retires keys nobody keeps (a key whose members were all re-typed is retired as dissolved). Writes refinery_complex_runs on every call. pg_cron only.';

REVOKE EXECUTE ON FUNCTION public.rebuild_refinery_complexes() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rebuild_refinery_complexes() TO service_role;

-- ─── 2 · Runs: the stability rule pinned, the nights read, the claims ──
ALTER TABLE public.reality_check_runs
  ADD COLUMN IF NOT EXISTS ks_split_rule   text NOT NULL DEFAULT 'baseline_halves_by_count',
  ADD COLUMN IF NOT EXISTS bm_nights_used  date[],
  ADD COLUMN IF NOT EXISTS firms_days_used date[],
  ADD COLUMN IF NOT EXISTS claims_issued   integer;

COMMENT ON COLUMN public.reality_check_runs.ks_split_rule IS
  'Mig 169: how the stability test splits the baseline — its usable nights ordered by date, the first floor(n/2) against the rest (lib/intel/ks.ts). CHECK-pinned.';
COMMENT ON COLUMN public.reality_check_runs.bm_nights_used IS
  'Mig 169: the usable Black Marble refinery nights (sensor_usable_nights) inside baseline_start..window_end when the tick ran. A later difference over the same range is a late night: the next cron run publishes a superseding tick.';
COMMENT ON COLUMN public.reality_check_runs.firms_days_used IS
  'Mig 169: the usable FIRMS refinery days inside baseline_start..window_end when the tick ran (same use as bm_nights_used).';
COMMENT ON COLUMN public.reality_check_runs.claims_issued IS
  'Mig 169: refinery-rc claims issued on this tick. NULL = not an issuing tick (claims issue on alternate ticks, never on a superseding tick); 0 = issuing tick that issued nothing.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcr_ks_split_pinned') THEN
    ALTER TABLE public.reality_check_runs ADD CONSTRAINT rcr_ks_split_pinned
      CHECK (ks_split_rule = 'baseline_halves_by_count');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcr_claims_issued_sane') THEN
    ALTER TABLE public.reality_check_runs ADD CONSTRAINT rcr_claims_issued_sane
      CHECK (claims_issued IS NULL OR (claims_issued >= 0 AND status = 'complete' AND supersedes_run_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcr_inputs_recorded') THEN
    ALTER TABLE public.reality_check_runs ADD CONSTRAINT rcr_inputs_recorded
      CHECK (status <> 'complete' OR (bm_nights_used IS NOT NULL AND firms_days_used IS NOT NULL));
  END IF;
END $$;

-- one live tick per (asset, data clock, superseded run): two cron runs racing
-- on the same clock cannot both publish; a failed run never blocks a retry
CREATE UNIQUE INDEX IF NOT EXISTS reality_check_runs_one_live_per_clock
  ON public.reality_check_runs (asset_class, data_clock_night, coalesce(supersedes_run_id, 0))
  WHERE status <> 'failed';

-- ─── 3 · The verdict shape §3.1 implies and mig 161 could not hold ─────
-- A dual-down complex below 12 baseline nights (no stability test) is
-- VOID_INSUFFICIENT_NIGHTS: never LEAD, never REFUTED. Every other binding of
-- the mig-161 constraint is kept.
ALTER TABLE public.reality_check_site_verdicts DROP CONSTRAINT IF EXISTS rcsv_coverage_voids;
ALTER TABLE public.reality_check_site_verdicts ADD CONSTRAINT rcsv_coverage_voids
  CHECK ((verdict = 'VOID_NOT_OBSERVED') = (coverage_state = 'NOT_OBSERVED')
     AND (coverage_state <> 'BELOW_FLOOR' OR verdict = 'VOID_INSUFFICIENT_NIGHTS')
     AND (verdict <> 'VOID_INSUFFICIENT_NIGHTS'
          OR coverage_state = 'BELOW_FLOOR'
          OR (coverage_state = 'OBSERVED'
              AND ks_tested IS FALSE
              AND heat_state IS NOT DISTINCT FROM 'HEAT_DOWN'
              AND coalesce(window_median < 0.60 * baseline_median, false))));

COMMENT ON CONSTRAINT rcsv_coverage_voids ON public.reality_check_site_verdicts IS
  'Mig 161, widened by mig 169: NOT_OBSERVED <=> VOID_NOT_OBSERVED; BELOW_FLOOR => VOID_INSUFFICIENT_NIGHTS; and VOID_INSUFFICIENT_NIGHTS on an OBSERVED row only for a complex whose heat and light are both down but whose baseline is too short for the stability test (ks_tested false, < 12 nights) — the lead floor of §3.1.';

-- ─── 4 · The tick's single read (TypeScript classifies, D-14) ──────────
-- One row per ACTIVE complex with its current members. Light: the mig-161
-- view's per-night MEDIANS (primary radiance and the 3x3 robustness median),
-- nights with neither retrieval dropped. Heat: the mig-161 view's heat days.
-- Nothing is classified here; there is no average anywhere.
CREATE OR REPLACE FUNCTION public.reality_check_tick_inputs(p_from date, p_to date)
RETURNS TABLE (
  cluster_key          text,
  members              text[],
  member_names         text[],
  light_nights         date[],
  radiance_median      double precision[],
  radiance_3x3_median  double precision[],
  heat_days            date[],
  heat_day             boolean[],
  non_refinery_members integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH cx AS (
    SELECT m.cluster_key                                                  AS ck,
           array_agg(m.facility_id ORDER BY m.facility_id)                 AS mem,
           array_agg(coalesce(r.refinery_name, m.facility_id) ORDER BY m.facility_id) AS names,
           (count(*) FILTER (WHERE r.site_type <> 'refinery'))::int        AS non_ref
      FROM refinery_complex_members m
      JOIN refinery_complexes c ON c.cluster_key = m.cluster_key AND c.retired_at IS NULL
      JOIN refineries r         ON r.id = m.facility_id
     WHERE m.left_at IS NULL
     GROUP BY m.cluster_key
  ),
  l AS (
    SELECT ln.cluster_key                                   AS ck,
           array_agg(ln.night ORDER BY ln.night)            AS nights,
           array_agg(ln.radiance_median ORDER BY ln.night)  AS rad,
           array_agg(ln.radiance_3x3_median ORDER BY ln.night) AS rad3
      FROM refinery_complex_light_nights ln
     WHERE ln.night BETWEEN p_from AND p_to
       AND (ln.radiance_median IS NOT NULL OR ln.radiance_3x3_median IS NOT NULL)
     GROUP BY ln.cluster_key
  ),
  h AS (
    SELECT hd.cluster_key                          AS ck,
           array_agg(hd.day ORDER BY hd.day)       AS days,
           array_agg(hd.heat_day ORDER BY hd.day)  AS heat
      FROM refinery_complex_heat_days hd
     WHERE hd.day BETWEEN p_from AND p_to
     GROUP BY hd.cluster_key
  )
  SELECT cx.ck, cx.mem, cx.names,
         coalesce(l.nights, '{}'::date[]),
         coalesce(l.rad,    '{}'::double precision[]),
         coalesce(l.rad3,   '{}'::double precision[]),
         coalesce(h.days,   '{}'::date[]),
         coalesce(h.heat,   '{}'::boolean[]),
         cx.non_ref
    FROM cx
    LEFT JOIN l ON l.ck = cx.ck
    LEFT JOIN h ON h.ck = cx.ck
   ORDER BY cx.ck;
$function$;

COMMENT ON FUNCTION public.reality_check_tick_inputs(date, date) IS
  'Reality Check PR-5 (mig 169). The TypeScript tick''s single read: one row per active refinery complex — current members, the per-night median radiance and median radiance_3x3 (px_hq_3x3 >= 5) on usable Black Marble nights from refinery_complex_light_nights, and the usable FIRMS days with heat_day from refinery_complex_heat_days, between p_from and p_to. Medians only; classifies nothing. Service role only.';

REVOKE EXECUTE ON FUNCTION public.reality_check_tick_inputs(date, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reality_check_tick_inputs(date, date) TO service_role;

-- ─── 5 · The monitor (D-7): recomputed on every read ───────────────────
CREATE OR REPLACE FUNCTION public.refinery_rc_walkforward(
  p_min_judged integer DEFAULT 90,
  p_alpha      integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
WITH fam(feature, ord, near_certain) AS (
  VALUES ('rc_heat_dark_persists',  1, false),
         ('rc_site_stays_lit',      2, false),
         ('rc_lead_light_persists', 3, false),
         ('rc_refutation_holds',    4, true)
),
c AS (
  SELECT r.id, r.feature, r.issued_at,
         (r.predicted_distribution->>'mean')::numeric AS p,
         (o.prediction_id IS NOT NULL)                AS closed,
         o.void_reason, o.brier, o.observed_value     AS y
    FROM predictions_register r
    LEFT JOIN prediction_outcomes o ON o.prediction_id = r.id
   WHERE r.source = 'refinery-rc'
),
feats AS (   -- the four families always; any other refinery-rc feature if one exists
  SELECT feature, ord, near_certain FROM fam
  UNION ALL
  SELECT DISTINCT c.feature, 99, NULL::boolean FROM c
   WHERE c.feature NOT IN (SELECT feature FROM fam)
),
j AS (       -- judged = scored: an outcome that is not VOID
  SELECT c.*, ntile(2) OVER (PARTITION BY c.feature ORDER BY c.issued_at, c.id) AS half
    FROM c
   WHERE c.closed AND c.void_reason IS NULL AND c.brier IS NOT NULL AND c.y IS NOT NULL
),
a AS (
  SELECT f.feature, f.ord, f.near_certain,
         (SELECT count(*) FROM c WHERE c.feature = f.feature)                               AS issued,
         (SELECT count(*) FROM c WHERE c.feature = f.feature AND c.void_reason IS NOT NULL) AS void,
         (SELECT count(*) FROM c WHERE c.feature = f.feature AND NOT c.closed)              AS open,
         count(j.id)                                                       AS n,
         coalesce(sum(j.y), 0)                                             AS k,
         sum(j.brier) / nullif(count(j.id), 0)                             AS brier,
         sum(j.y)     / nullif(count(j.id), 0)                             AS base,
         sum(CASE WHEN (j.p >= 0.5) = (j.y = 1) THEN 1 ELSE 0 END)::numeric
                      / nullif(count(j.id), 0)                             AS hit_rate,
         count(j.id)                             FILTER (WHERE j.half = 1) AS n1,
         (sum(j.brier) FILTER (WHERE j.half = 1))
           / nullif(count(j.id) FILTER (WHERE j.half = 1), 0)              AS brier1,
         (sum(j.y) FILTER (WHERE j.half = 1))
           / nullif(count(j.id) FILTER (WHERE j.half = 1), 0)              AS base1,
         count(j.id)                             FILTER (WHERE j.half = 2) AS n2,
         (sum(j.brier) FILTER (WHERE j.half = 2))
           / nullif(count(j.id) FILTER (WHERE j.half = 2), 0)              AS brier2,
         (sum(j.y) FILTER (WHERE j.half = 2))
           / nullif(count(j.id) FILTER (WHERE j.half = 2), 0)              AS base2
    FROM feats f
    LEFT JOIN j ON j.feature = f.feature
   GROUP BY f.feature, f.ord, f.near_certain
),
s AS (       -- Brier skill against the family's own base rate; undefined at a base rate of 0 or 1
  SELECT a.*,
         CASE WHEN base  * (1 - base)  > 0.001 THEN 1 - brier  / (base  * (1 - base))  END AS skill,
         CASE WHEN base1 * (1 - base1) > 0.001 THEN 1 - brier1 / (base1 * (1 - base1)) END AS skill1,
         CASE WHEN base2 * (1 - base2) > 0.001 THEN 1 - brier2 / (base2 * (1 - base2)) END AS skill2
    FROM a
),
st AS (
  SELECT s.*,
         CASE WHEN n < p_min_judged                   THEN 'calibrating'
              WHEN skill1 IS NULL OR skill2 IS NULL   THEN 'calibrating'
              WHEN skill1 < 0 AND skill2 < 0          THEN 'suspended'
              ELSE                                         'scored' END AS status,
         CASE WHEN n < p_min_judged
                THEN format('Calibrating: %s of %s judged claims', n, p_min_judged)
              WHEN skill1 IS NULL OR skill2 IS NULL
                THEN 'Calibrating: split-half skill is undefined (a half has a base rate of 0 or 1) — shown with its Brier and hit rate; never suspended or promoted on an undefined score'
              WHEN skill1 < 0 AND skill2 < 0
                THEN 'Suspended: negative walk-forward skill in both halves — the issuer stops issuing this family'
              ELSE 'Scored: skill defined in both halves and not negative in both' END AS reason
    FROM s
)
SELECT jsonb_build_object(
  'as_of',      now(),
  'source',     'refinery-rc',
  'track',      'machine',
  'min_judged', p_min_judged,
  'alpha',      p_alpha,
  'rule',       format('p = (k + %s x 0.5) / (n + %s), k and n from the family''s judged (scored, non-VOID) claims before issue. Calibrating until %s judged; at %s judged a family with negative split-half skill in BOTH halves is suspended; a half with a base rate of 0 or 1 has no defined skill and keeps the family Calibrating. Every family counts in the machine-track headline.',
                       p_alpha, p_alpha, p_min_judged, p_min_judged),
  'families',   coalesce((
    SELECT jsonb_object_agg(st.feature, jsonb_build_object(
             'order',        st.ord,
             'near_certain', st.near_certain,
             'issued',       st.issued,
             'judged',       st.n,
             'k',            st.k,
             'void',         st.void,
             'open',         st.open,
             'base_rate',    round(st.base, 4),
             'brier',        round(st.brier, 4),
             'hit_rate',     round(st.hit_rate, 4),
             'skill',        round(st.skill, 4),
             'skill_half_1', round(st.skill1, 4),
             'skill_half_2', round(st.skill2, 4),
             'n_half_1',     st.n1,
             'n_half_2',     st.n2,
             'p_next',       round((st.k + p_alpha * 0.5) / (st.n + p_alpha), 4),
             'status',       st.status,
             'reason',       st.reason))
      FROM st), '{}'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.refinery_rc_walkforward(integer, integer) IS
  'Reality Check PR-5 (mig 169): the monitor for the refinery-rc claim families (mig-152 pattern, recomputed on read). Per family: issued, judged, k, void, open, base rate, Brier, hit rate, walk-forward skill overall and per half, the next claim''s p = (k + alpha x 0.5)/(n + alpha), and a status — calibrating (< min_judged, or skill undefined in a half), suspended (skill negative in both halves), scored. The issuer reads k, n and status from here. Service role only.';

REVOKE EXECUTE ON FUNCTION public.refinery_rc_walkforward(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refinery_rc_walkforward(integer, integer) TO service_role;

-- ── the proof kind (mig 147 mechanism; mig 156 body, one kind added) ──
CREATE OR REPLACE FUNCTION public.ledger_watch_prove(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  k    text := p->>'kind';
  n    bigint; n2 bigint; t timestamptz; b numeric; base numeric; ok boolean; ev jsonb; want int;
BEGIN
  IF k = 'outcome_exists' THEN
    SELECT count(*), min(o.observed_at), count(*) FILTER (WHERE o.void_reason IS NOT NULL) INTO n, t, n2
      FROM public.prediction_outcomes o JOIN public.predictions_register r ON r.id = o.prediction_id
     WHERE r.source = p->>'source';
    RETURN jsonb_build_object('proven', n >= COALESCE((p->>'min_n')::int, 1),
             'evidence', jsonb_build_object('source', p->>'source', 'outcomes', n, 'void', n2, 'first_observed_at', t));
  ELSIF k = 'family_scored_n' THEN
    SELECT count(*), avg(o.brier), avg(o.observed_value) INTO n, b, base
      FROM public.prediction_outcomes o JOIN public.predictions_register r ON r.id = o.prediction_id
     WHERE r.feature = p->>'feature' AND o.void_reason IS NULL AND o.brier IS NOT NULL;
    RETURN jsonb_build_object('proven', n >= COALESCE((p->>'min_n')::int, 10),
             'evidence', jsonb_build_object('feature', p->>'feature', 'scored', n, 'brier', round(b, 4),
                                            'skill', CASE WHEN base * (1 - base) > 0.001 THEN round(1 - b / (base * (1 - base)), 4) END));
  ELSIF k = 'cohort_complete' THEN
    -- mig 156: complete = every deadline passed AND every claim judged (scored
    -- or void). The 09-06 item flipped SEEN at 23:26 UTC on 2026-09-09 with 586
    -- of 8,243 live claims scored, because deadlines alone were the test.
    SELECT count(*), bool_and(r.resolves_at <= now()),
           count(o.prediction_id) FILTER (WHERE o.void_reason IS NULL AND o.brier IS NOT NULL),
           avg(o.brier) FILTER (WHERE o.void_reason IS NULL AND o.brier IS NOT NULL),
           avg(o.observed_value) FILTER (WHERE o.void_reason IS NULL AND o.brier IS NOT NULL),
           count(*) FILTER (WHERE o.prediction_id IS NULL)
      INTO n, ok, n2, b, base, want
      FROM public.predictions_register r LEFT JOIN public.prediction_outcomes o ON o.prediction_id = r.id
     WHERE COALESCE(r.track, 'house') = p->>'track' AND (r.issued_at AT TIME ZONE 'UTC')::date = (p->>'day')::date;
    RETURN jsonb_build_object('proven', n > 0 AND COALESCE(ok, false) AND COALESCE(want, 0) = 0,
             'evidence', jsonb_build_object('track', p->>'track', 'day', p->>'day', 'issued', n, 'complete', COALESCE(ok, false),
                                            'open', COALESCE(want, 0), 'judged', COALESCE(want, 0) = 0,
                                            'scored', n2, 'brier', round(b, 4),
                                            'skill', CASE WHEN base * (1 - base) > 0.001 THEN round(1 - b / (base * (1 - base)), 4) END));
  ELSIF k = 'nights_judged_after_ingest' THEN
    want := jsonb_array_length(p->'nights');
    SELECT count(*), bool_and(COALESCE(d.judged_at >= i.ran_at, false)),
           jsonb_object_agg(i.night, jsonb_build_object('judged_at', d.judged_at, 'ingest_ran_at', i.ran_at))
      INTO n, ok, ev
      FROM jsonb_array_elements_text(p->'nights') AS x(night)
      JOIN public.blackmarble_ingest_runs i ON i.night = x.night::date
      LEFT JOIN public.nightlights_detect_runs d ON d.night = i.night;
    RETURN jsonb_build_object('proven', n = want AND COALESCE(ok, false), 'evidence', COALESCE(ev, '{}'::jsonb) || jsonb_build_object('nights_found', n, 'nights_wanted', want));
  ELSIF k = 'issuance_run_exists' THEN
    SELECT count(*), max(ran_at) INTO n, t FROM public.issuance_runs WHERE source = p->>'source';
    RETURN jsonb_build_object('proven', n > 0, 'evidence', jsonb_build_object('source', p->>'source', 'runs', n, 'newest', t));
  ELSIF k = 'alert_cleared' THEN
    SELECT count(*), max(at) INTO n, t FROM public.ledger_alert_events WHERE alert_id = p->>'alert_id' AND transition = 'cleared';
    RETURN jsonb_build_object('proven', n > 0, 'evidence', jsonb_build_object('alert_id', p->>'alert_id', 'cleared', n, 'last_cleared_at', t));
  ELSIF k = 'scorer_voided' THEN
    SELECT count(*), max(ran_at) INTO n, t FROM public.score_predictions_runs WHERE voided >= COALESCE((p->>'min_voided')::int, 1);
    RETURN jsonb_build_object('proven', n > 0, 'evidence', jsonb_build_object('ticks_with_voids', n, 'newest', t));
  ELSIF k = 'chokepoint_daily_admissible' THEN
    -- mig 152: the daily chokepoint question is admitted by its own walk-forward, never by a click.
    ev := public.chokepoint_daily_walkforward(
            COALESCE((p->>'since')::date, DATE '2026-08-24'), 14, 10, 0.35,
            COALESCE((p->>'min_pooled')::int, 90), COALESCE((p->>'min_strait')::int, 20));
    RETURN jsonb_build_object('proven', COALESCE((ev->>'admissible')::boolean, false),
             'evidence', jsonb_build_object('pooled', ev->'pooled', 'straits', ev->'straits', 'rule', ev->>'rule', 'as_of', ev->>'as_of'));
  ELSIF k = 'refinery_rc_walkforward' THEN
    -- mig 169: the Reality Check claim families' monitor. Proven when the named
    -- family (or, with none named, any refinery-rc family) has >= min_judged
    -- judged claims; the monitor then reads it scored or suspended, or keeps it
    -- Calibrating on an undefined skill. Recomputed on read, never a click.
    want := COALESCE((p->>'min_judged')::int, 90);
    ev := public.refinery_rc_walkforward(want, 20);
    IF p ? 'family' THEN
      ok := COALESCE((ev->'families'->(p->>'family')->>'judged')::int, 0) >= want;
    ELSE
      SELECT COALESCE(bool_or((x.value->>'judged')::int >= want), false) INTO ok
        FROM jsonb_each(ev->'families') AS x;
    END IF;
    RETURN jsonb_build_object('proven', COALESCE(ok, false),
             'evidence', jsonb_build_object('families', ev->'families', 'rule', ev->>'rule',
                                            'min_judged', want, 'as_of', ev->>'as_of'));
  END IF;
  RETURN jsonb_build_object('proven', false, 'evidence', jsonb_build_object('error', 'unknown proof kind: ' || COALESCE(k, 'null')));
END;
$$;

-- ── the seeded watch item: due when 90 judged claims in one family is first
--    arithmetically possible. 2026-09-19: ~9-10 thermally dark complexes a
--    tick → ~9 claims per family per issuing tick, one issuing tick per 14
--    data-clock nights → the tenth issuing tick ≈ 2027-01-24, judged ≈ 16
--    days later (FIRMS window + finality).
INSERT INTO public.ledger_watch_items (due_at, text, proof)
SELECT '2027-02-15 12:00+00'::timestamptz,
       'Reality Check refinery-rc: the first claim family reaches 90 judged claims — refinery_rc_walkforward() then labels it scored or suspended (split-half skill), or keeps it Calibrating if a half has a base rate of 0 or 1. Until then every family reads Calibrating and counts in the machine-track headline.',
       '{"kind":"refinery_rc_walkforward","min_judged":90}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.ledger_watch_items
                    WHERE text LIKE 'Reality Check refinery-rc: the first claim family reaches 90 judged%');

-- ─── 6 · The change log (D-5: no parameter or rule changes silently) ───
INSERT INTO public.ledger_change_log (at, pr, note)
SELECT now(), '#540 · mig 169',
       'Reality Check method (mig 169): the refinery population is site_type = ''refinery'' only — the 96 re-typed sites leave their complexes and the 59 complexes whose members were all re-typed are retired as dissolved (never deleted). A complex with heat and light both down but fewer than 12 baseline nights (no stability test possible) reads VOID_INSUFFICIENT_NIGHTS — never a lead. Stability test: KS on the baseline''s per-night medians, halves by count.'
 WHERE NOT EXISTS (SELECT 1 FROM public.ledger_change_log WHERE note LIKE 'Reality Check method (mig 169)%');

-- ─── 7 · Re-cluster now under the filter (the 03:20 UTC job does the rest) ─
SELECT public.rebuild_refinery_complexes();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — ONE SELECT (the SQL Editor shows only the last statement's rows).
-- Every row must read ok = true. Expectations measured read-only 2026-09-19.
-- Rows 6 and 7 depend on whether the old function's 03:20 UTC run on
-- 2026-09-20 happened before this file: before → minted 16, joined 18,
-- matched 279; after → minted 0, joined 0, matched 295 (it minted the 16
-- then). Either way: active 295, dissolved 59, members 353, left 96.
-- ═══════════════════════════════════════════════════════════════════════
WITH lr AS (
  SELECT * FROM public.refinery_complex_runs ORDER BY ran_at DESC, id DESC LIMIT 1
),
wf AS (SELECT public.refinery_rc_walkforward() AS j),
checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'rebuild_refinery_complexes filters site_type (both places)', '2',
         ((length(d) - length(replace(d, 'r.site_type = ''refinery''', ''))) / length('r.site_type = ''refinery'''))::text
    FROM (SELECT pg_get_functiondef('public.rebuild_refinery_complexes()'::regprocedure) AS d) x
  UNION ALL
  SELECT 2, 'active complexes', '295',
         (SELECT count(*)::text FROM public.refinery_complexes WHERE retired_at IS NULL)
  UNION ALL
  SELECT 3, 'complexes retired as dissolved (all members re-typed)', '59',
         (SELECT count(*)::text FROM public.refinery_complexes WHERE retired_reason = 'dissolved')
  UNION ALL
  SELECT 4, 'current members · of them not site_type refinery', '353 · 0',
         (SELECT count(*) || ' · ' || count(*) FILTER (WHERE r.site_type <> 'refinery')
            FROM public.refinery_complex_members m JOIN public.refineries r ON r.id = m.facility_id
           WHERE m.left_at IS NULL)
  UNION ALL
  SELECT 5, 'latest rebuild: watched · components · merged · dissolved · left', '353 · 295 · 0 · 59 · 96',
         (SELECT concat_ws(' · ', watched_facilities, components, merged, dissolved, members_left) FROM lr)
  UNION ALL
  SELECT 6, 'latest rebuild: matched · minted · joined (see header note)', '279 · 16 · 18  OR  295 · 0 · 0',
         (SELECT concat_ws(' · ', matched, minted, members_joined) FROM lr)
  UNION ALL
  SELECT 7, 'no retired key still has a current member', '0',
         (SELECT count(*)::text FROM public.refinery_complex_members m
            JOIN public.refinery_complexes c ON c.cluster_key = m.cluster_key
           WHERE m.left_at IS NULL AND c.retired_at IS NOT NULL)
  UNION ALL
  SELECT 8, 'runs columns ks_split_rule · bm_nights_used · firms_days_used · claims_issued', '4',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'reality_check_runs'
             AND column_name IN ('ks_split_rule', 'bm_nights_used', 'firms_days_used', 'claims_issued'))
  UNION ALL
  SELECT 9, 'new run CHECKs + one-live-per-clock index', '3 · true',
         (SELECT count(*)::text FROM pg_constraint
           WHERE conname IN ('rcr_ks_split_pinned', 'rcr_claims_issued_sane', 'rcr_inputs_recorded'))
         || ' · ' || (to_regclass('public.reality_check_runs_one_live_per_clock') IS NOT NULL)::text
  UNION ALL
  SELECT 10, 'rcsv_coverage_voids carries the dual-down lead floor', 'true',
         (SELECT (pg_get_constraintdef(oid) LIKE '%ks_tested IS FALSE%')::text FROM pg_constraint
           WHERE conname = 'rcsv_coverage_voids'
             AND conrelid = 'public.reality_check_site_verdicts'::regclass)
  UNION ALL
  SELECT 11, 'verdict CHECKs still present (19 from 161)', '19',
         (SELECT count(*)::text FROM pg_constraint
           WHERE conrelid = 'public.reality_check_site_verdicts'::regclass AND contype = 'c')
  UNION ALL
  SELECT 12, 'tick inputs on the first real tick range (07-25..09-08): complexes · members', '295 · 353',
         (SELECT count(*) || ' · ' || sum(cardinality(members))
            FROM public.reality_check_tick_inputs(DATE '2026-07-25', DATE '2026-09-08'))
  UNION ALL
  SELECT 13, 'monitor: four families, all calibrating, judged 0, p_next 0.5', '4 · 4 · 0 · 0.5',
         (SELECT count(*) || ' · ' || count(*) FILTER (WHERE x.value->>'status' = 'calibrating')
                 || ' · ' || coalesce(sum((x.value->>'judged')::int), 0)
                 || ' · ' || coalesce(min((x.value->>'p_next')::numeric), 0.5)::numeric(4,1)
            FROM wf, jsonb_each(wf.j->'families') x)
  UNION ALL
  SELECT 14, 'watch proof kind answers (not yet proven)', 'false',
         (public.ledger_watch_prove('{"kind":"refinery_rc_walkforward","min_judged":90}'::jsonb)->>'proven')
  UNION ALL
  SELECT 15, 'seeded watch item', '1',
         (SELECT count(*)::text FROM public.ledger_watch_items
           WHERE proof->>'kind' = 'refinery_rc_walkforward')
  UNION ALL
  SELECT 16, 'change-log row', '1',
         (SELECT count(*)::text FROM public.ledger_change_log WHERE note LIKE 'Reality Check method (mig 169)%')
  UNION ALL
  SELECT 17, 'anon/authenticated cannot execute the three new or changed functions', 'false',
         (has_function_privilege('anon', 'public.reality_check_tick_inputs(date,date)', 'EXECUTE')
          OR has_function_privilege('authenticated', 'public.reality_check_tick_inputs(date,date)', 'EXECUTE')
          OR has_function_privilege('anon', 'public.refinery_rc_walkforward(integer,integer)', 'EXECUTE')
          OR has_function_privilege('authenticated', 'public.refinery_rc_walkforward(integer,integer)', 'EXECUTE')
          OR has_function_privilege('anon', 'public.rebuild_refinery_complexes()', 'EXECUTE'))::text
)
SELECT ord, check_name, expected, actual,
       CASE WHEN ord = 6 THEN actual IN ('279 · 16 · 18', '295 · 0 · 0')
            ELSE actual = expected END AS ok
  FROM checks
 ORDER BY ord;
