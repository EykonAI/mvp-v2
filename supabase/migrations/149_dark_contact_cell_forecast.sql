-- 149 · Dark-contact forecast = the CELL's rate, not the box's.
--
-- WHY
-- ---
-- Since mig 125 every dark-contact claim in a box carries the same number: the
-- box's reappearance rate. Skill is discrimination, and one number per box
-- scores zero INSIDE the box by construction. On the last complete cohort
-- (issued 2026-09-01) three of the five issuing boxes sit at their base rate:
-- asia-pacific −0.001, americas-atl −0.015, malacca −0.041. The forecaster
-- averages away what the event row already knows at the moment it opens.
--
-- MEASURED FIRST (read-only, 2026-09-09, 45,166 completed resolved events
-- opened 08-24 → 09-01; reappearance rate by feature, boxes pooled):
--   flag                  NL 0.899 · ES 0.901 · PT 0.876 · GR 0.874 · DE 0.851
--                         vs LR 0.677 · PA 0.664 · MH 0.653 · ID 0.605 · HK 0.687
--   flag of convenience   0 → 0.813 · 1 → 0.683
--   speed at last fix     < 0.5 kn 0.844 · 0.5–5 0.819 · 5–12 0.782 · 12+ 0.710
--   vanished under way    0 → 0.837 · 1 → 0.759
--   name known            yes 0.800 · no 0.646
--   silence ratio at open, own cadence: weak (decile spread 0.76–0.86, mostly
--   noise); hour and weekday: confounded with the day (the 08-29/30 cohorts
--   alone make the weekend effect); vessel_type: null on 98 % of rows
--   (vessel_positions.vessel_type is not populated by the feed).
--
-- OUT OF TIME (rates fitted on events opened before 2026-08-29, n = 25,417;
-- scored on 08-29 → 09-01, n = 19,749, base 0.853):
--   box rate (mig 125)                            Brier 0.12848   BSS −0.026
--   cell = flag × speed band × name, α = 20       Brier 0.11966   BSS +0.045
--   same, hierarchical box → box×flag → cell      Brier 0.12031   (no better)
--   same, cell only when n ≥ 50 / n ≥ 100         Brier 0.12171 / 0.12181
--   same, cell only when its LOO beats the box    Brier 0.12308
--   α = 5 / 10 / 20 / 50 / 100                    0.12056 / 0.12017 / 0.12003 / 0.12033 / 0.12101
-- The shrinkage IS the gate: withholding the cell rate from thin cells loses
-- skill, because a cell with n = 0 is already exactly the box rate and one
-- with n = 20 is half-way there. So every claim gets its cell forecast and
-- nothing is gated on n. Cells with n ≥ 200 are REPORTED
-- (dark_contact_cell_report) so a reader can see where the discrimination is.
--
-- LEAVE-ONE-OUT ON ALL 45,166, PER BOX — BSS against the box's OWN base rate,
-- so the box forecast reads 0.000 by construction; sharpness = sd of forecast:
--   europe-med    n = 28,858   cell +0.032   sharpness 0.000 → 0.061
--   asia-pacific  n =  7,054   cell +0.114   0.134
--   americas-atl  n =  4,557   cell +0.071   0.091
--   malacca       n =  2,677   cell +0.178   0.176
--   africa-io     n =  1,028   cell +0.069   0.089
--   suez          n =    514   cell +0.101   0.096
--   bosphorus     n =    464   cell +0.019   0.052
-- Example cells (n ≥ 200): asia-pacific ID/s2 0.538 and PA/s2 0.498 against a
-- box rate of 0.717; HK/s0 0.925; malacca SG/s2 0.872 against 0.586;
-- europe-med NO/s0 0.736 and GB/s1 0.735 against 0.853, ES/s0 0.951.
--
-- THE RULE (recorded on every claim as forecast_basis / forecast_cell)
-- ---------------------------------------------------------------------
--   cell     = flag (raw ISO code, '?' when unknown)
--              × speed band at last fix (s0 < 0.5 kn · s1 < 5 · s2 < 12 · s3 ≥ 12)
--              × name known (n1) or not (n0)
--   forecast = (k_cell + α · r_box) / (n_cell + α), α = 20,
--              r_box = the box's Laplace rate over completed cohorts (mig 125)
--   Completed cohorts only (deadline passed), exactly as before.
--   SELECTION IS UNCHANGED: box eligibility, the informative band, the daily
--   cap and the confidence order are mig 125 verbatim. Only the number on the
--   claim changes.
--
-- ONE key function. The cell key is computed by dark_contact_cell_key() and
-- reaches the issuer through the view dark_contact_open_for_claims — the
-- TypeScript never re-derives it, so SQL and code cannot disagree on a band
-- edge. The plan keeps its mig-125 signature and shape (rule, boxes) and adds
-- rule.forecast / cell_version / cell_alpha, cells and cell_summary.
--
-- GRANTS. The five plan RPCs (migs 125–129) were left EXECUTE for anon and
-- authenticated by Supabase's default privileges (the mig-143 audit only
-- catches VOLATILE functions). Nothing in the browser calls them — the
-- issuers, the ledger route and the monitor all run with the service role —
-- so they are revoked here by role name, like every admin reader since 139.

BEGIN;

-- ── The cell key ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dark_contact_cell_key(
  p_flag     text,
  p_speed_kn double precision,
  p_name     text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_flag, '?') || '/' ||
         CASE WHEN p_speed_kn IS NULL THEN 's?'
              WHEN p_speed_kn < 0.5  THEN 's0'
              WHEN p_speed_kn < 5    THEN 's1'
              WHEN p_speed_kn < 12   THEN 's2'
              ELSE 's3' END || '/' ||
         CASE WHEN p_name IS NULL OR btrim(p_name) = '' THEN 'n0' ELSE 'n1' END;
$$;

COMMENT ON FUNCTION public.dark_contact_cell_key(text, double precision, text) IS
  'Dark-contact forecast cell: flag / speed band at last fix (0.5, 5, 12 kn) / name known (mig 149). The one place the cell is defined.';

-- ── Open events, with their cell, for the issuer ───────────────────────────
CREATE OR REPLACE VIEW public.dark_contact_open_for_claims
WITH (security_invoker = true) AS
  SELECT id, mmsi, name, flag, box_slug, last_speed_kn, cadence_hours,
         silence_ratio_at_open, confidence_at_open, gap_started_at, opened_at,
         deadline_at, status,
         public.dark_contact_cell_key(flag, last_speed_kn, name) AS cell_key
  FROM public.dark_contact_events
  WHERE status = 'open';

COMMENT ON VIEW public.dark_contact_open_for_claims IS
  'Open dark-contact events with the forecast cell key computed in SQL (mig 149); the issuer reads this, never dark_contact_events directly.';

-- ── The plan, v2: same signature and shape as mig 125, plus cells ──────────
CREATE OR REPLACE FUNCTION public.dark_contact_issuance_plan(
  p_daily_cap integer DEFAULT 200,
  p_min_n     integer DEFAULT 200,
  p_band_lo   numeric DEFAULT 0.20,
  p_band_hi   numeric DEFAULT 0.80
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH pop AS (
  -- Completed cohorts only: deadline passed, so both outcomes were possible.
  SELECT box_slug,
         (resolution = 'reappeared')::int AS y,
         public.dark_contact_cell_key(flag, last_speed_kn, name) AS cell
  FROM dark_contact_events
  WHERE status = 'resolved' AND deadline_at <= now() AND box_slug IS NOT NULL
),
cohorts AS (
  SELECT box_slug, sum(y) AS k, count(*) AS n FROM pop GROUP BY box_slug
),
rates AS (
  SELECT box_slug, k, n,
         round(((k + 1.0) / (n + 2.0))::numeric, 4) AS rate
  FROM cohorts
),
cells AS (
  -- The cell's own count, shrunk to its box's Laplace rate with weight α = 20.
  -- A cell with n = 0 does not appear and the issuer falls back to the box
  -- rate, which is exactly what this formula gives at n = 0.
  SELECT p.box_slug, p.cell,
         sum(p.y)  AS kc,
         count(*)  AS nc,
         round(((sum(p.y) + 20.0 * ((c.k + 1.0) / (c.n + 2.0))) / (count(*) + 20.0))::numeric, 4) AS rate
  FROM pop p JOIN cohorts c USING (box_slug)
  GROUP BY p.box_slug, p.cell, c.k, c.n
),
issued_today AS (
  SELECT r.context->>'box_slug' AS box_slug, count(*) AS issued
  FROM predictions_register r
  WHERE r.source = 'ais-darkgap'
    AND r.issued_at >= date_trunc('day', now())
  GROUP BY 1
)
SELECT jsonb_build_object(
  'rule', jsonb_build_object(
    'band_lo', p_band_lo, 'band_hi', p_band_hi,
    'min_n', p_min_n, 'daily_cap_per_box', p_daily_cap,
    'basis', 'laplace-shrunk reappearance rate over completed cohorts, per box',
    'order', 'confidence_at_open desc',
    'forecast', 'cell rate shrunk to the box rate: (k_cell + 20·r_box) / (n_cell + 20); cell = flag × speed band × name known (mig 149)',
    'cell_version', 'v2',
    'cell_alpha', 20,
    'speed_bands_kn', jsonb_build_array(0.5, 5, 12)
  ),
  'boxes', COALESCE((
    SELECT jsonb_object_agg(x.box_slug, jsonb_build_object(
      'k', x.k, 'n', x.n, 'rate', x.rate,
      'eligible', x.eligible,
      'reason', x.reason,
      'issued_today', COALESCE(i.issued, 0),
      'remaining', CASE WHEN x.eligible
                        THEN greatest(0, p_daily_cap - COALESCE(i.issued, 0)::int)
                        ELSE 0 END
    ))
    FROM (
      SELECT r.*,
             (r.n >= p_min_n AND r.rate >= p_band_lo AND r.rate <= p_band_hi) AS eligible,
             CASE WHEN r.n < p_min_n THEN 'thin: n < ' || p_min_n
                  WHEN r.rate < p_band_lo OR r.rate > p_band_hi
                       THEN 'outside informative band [' || p_band_lo || ',' || p_band_hi || ']'
                  ELSE NULL END AS reason
      FROM rates r
    ) x
    LEFT JOIN issued_today i ON i.box_slug = x.box_slug
  ), '{}'::jsonb),
  'cells', COALESCE((
    SELECT jsonb_object_agg(c.box_slug || '|' || c.cell,
                            jsonb_build_object('k', c.kc, 'n', c.nc, 'rate', c.rate))
    FROM cells c
  ), '{}'::jsonb),
  'cell_summary', COALESCE((
    SELECT jsonb_object_agg(s.box_slug, jsonb_build_object('cells', s.cells, 'cells_200', s.cells_200, 'rows', s.rows))
    FROM (
      SELECT box_slug, count(*) AS cells, count(*) FILTER (WHERE nc >= 200) AS cells_200, sum(nc) AS rows
      FROM cells GROUP BY box_slug
    ) s
  ), '{}'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.dark_contact_issuance_plan(integer, integer, numeric, numeric) IS
  'Per-box eligibility and quota (mig 125) plus per-cell forecast rates (mig 149: flag × speed band × name, shrunk to the box rate, α = 20) for machine-track dark-contact issuance.';

-- ── The evidence, per cell, for the monitor ────────────────────────────────
CREATE OR REPLACE FUNCTION public.dark_contact_cell_report(
  p_min_n integer DEFAULT 200,
  p_alpha numeric DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH pop AS (
  SELECT box_slug,
         (resolution = 'reappeared')::int AS y,
         public.dark_contact_cell_key(flag, last_speed_kn, name) AS cell
  FROM dark_contact_events
  WHERE status = 'resolved' AND deadline_at <= now() AND box_slug IS NOT NULL
),
w AS (
  SELECT box_slug, cell, y,
         sum(y)   OVER (PARTITION BY box_slug)       AS kb,
         count(*) OVER (PARTITION BY box_slug)       AS nb,
         sum(y)   OVER (PARTITION BY box_slug, cell) AS kc,
         count(*) OVER (PARTITION BY box_slug, cell) AS nc
  FROM pop
),
loo AS (
  -- Leave-one-out: every event is scored by rates fitted WITHOUT it, at both
  -- levels (the box rate it shrinks toward is left out too).
  SELECT box_slug, cell, y, nc,
         (kb - y + 1.0) / (nb - 1 + 2.0) AS rb,
         (kc - y + p_alpha * ((kb - y + 1.0) / (nb - 1 + 2.0))) / (nc - 1 + p_alpha) AS rc
  FROM w
),
per_box AS (
  SELECT box_slug,
         count(*) AS n,
         round(avg(y)::numeric, 4) AS base,
         round(avg((rb - y)^2)::numeric, 5) AS brier_box,
         round(avg((rc - y)^2)::numeric, 5) AS brier_cell,
         round((1 - avg((rb - y)^2) / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS bss_box,
         round((1 - avg((rc - y)^2) / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS bss_cell,
         round(stddev_pop(rc)::numeric, 4) AS sharpness_cell,
         count(DISTINCT cell) AS cells,
         count(DISTINCT cell) FILTER (WHERE nc >= p_min_n) AS cells_min_n
  FROM loo GROUP BY box_slug
),
per_cell AS (
  SELECT box_slug, cell,
         count(*) AS n,
         round(avg(y)::numeric, 4) AS rate,
         round(avg(rc)::numeric, 4) AS forecast,
         round(avg((rb - y)^2)::numeric, 5) AS brier_box,
         round(avg((rc - y)^2)::numeric, 5) AS brier_cell
  FROM loo GROUP BY box_slug, cell
  HAVING count(*) >= p_min_n
),
pooled AS (
  SELECT count(*) AS n,
         round(avg(y)::numeric, 4) AS base,
         round(avg((rb - y)^2)::numeric, 5) AS brier_box,
         round(avg((rc - y)^2)::numeric, 5) AS brier_cell,
         round((1 - avg((rb - y)^2) / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS bss_box,
         round((1 - avg((rc - y)^2) / NULLIF(avg(y) * (1 - avg(y)), 0))::numeric, 4) AS bss_cell,
         round(stddev_pop(rc)::numeric, 4) AS sharpness_cell
  FROM loo
)
SELECT jsonb_build_object(
  'as_of', now(),
  'method', 'leave-one-out on completed cohorts; forecast = (k_cell + α·r_box)/(n_cell + α) with the box rate left out too; BSS against the box''s own base rate, so the box forecast scores 0 by construction',
  'alpha', p_alpha,
  'min_n', p_min_n,
  'pooled', (SELECT to_jsonb(p) FROM pooled p),
  'boxes', COALESCE((SELECT jsonb_object_agg(b.box_slug, to_jsonb(b) - 'box_slug') FROM per_box b), '{}'::jsonb),
  'cells', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.box_slug, c.n DESC) FROM per_cell c), '[]'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.dark_contact_cell_report(integer, numeric) IS
  'Leave-one-out evidence for the dark-contact cell forecast (mig 149): pooled, per box and per cell with n ≥ p_min_n. Admin reader.';

-- ── The change, on the public record ───────────────────────────────────────
-- The cohort view (mig 137) marks the day the forecaster changed. Apply and
-- merge happen on the same day; the PR number is the merge that deployed it.
INSERT INTO public.ledger_change_log (at, pr, note) VALUES
  (now(), '#TBD', 'dark-contact forecast = the cell''s rate (flag × speed band × name known), shrunk to the box rate; selection rule unchanged')
ON CONFLICT (at) DO NOTHING;

-- ── Grants: service role only, by role name (mig 139 lesson) ───────────────
REVOKE EXECUTE ON FUNCTION public.dark_contact_cell_key(text, double precision, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.dark_contact_cell_key(text, double precision, text) TO service_role;

REVOKE ALL    ON public.dark_contact_open_for_claims FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.dark_contact_open_for_claims TO service_role;

REVOKE EXECUTE ON FUNCTION public.dark_contact_issuance_plan(integer, integer, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.dark_contact_issuance_plan(integer, integer, numeric, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.dark_contact_cell_report(integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.dark_contact_cell_report(integer, numeric) TO service_role;

-- The other plan RPCs (migs 126–129), same reason, same fix. Server-side callers only.
REVOKE EXECUTE ON FUNCTION public.firms_recovery_plan(integer, integer, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.blackmarble_claim_plan(integer, integer, numeric, integer, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.eia_draw_plan(text, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.house_family_calibration(numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.firms_recovery_plan(integer, integer, numeric, numeric, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.blackmarble_claim_plan(integer, integer, numeric, integer, numeric, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.eia_draw_plan(text, numeric, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.house_family_calibration(numeric) TO service_role;

COMMIT;

-- STEP 1 — READ ONLY, run BEFORE applying (2026-09-09 expectations):
--   SELECT box_slug, count(*) AS n, sum((resolution = 'reappeared')::int) AS k
--   FROM dark_contact_events
--   WHERE status = 'resolved' AND deadline_at <= now() AND box_slug IS NOT NULL
--   GROUP BY 1 ORDER BY 2 DESC;
--   -- expect ≥ 45,166 rows over 8 boxes: europe-med 28,858 · asia-pacific 7,054 ·
--   -- americas-atl 4,557 · malacca 2,677 · africa-io 1,028 · suez 514 · bosphorus 464 ·
--   -- panama 14 (each grows as the 09-06+ cohorts complete)
--
-- VERIFY, run AFTER applying (the rows must be on screen, not the banner):
--   SELECT dark_contact_issuance_plan()->'rule'->>'cell_version' AS v;            -- v2
--   SELECT jsonb_pretty(dark_contact_issuance_plan()->'cell_summary');             -- ~1,420 cells, 8 boxes
--   SELECT jsonb_pretty(dark_contact_cell_report(200)->'pooled');
--   --   n ≥ 45,166 · base ≈ 0.794 · brier_box ≈ 0.1525 · brier_cell ≈ 0.1419 · bss 0.067 → 0.132 · sharpness_cell ≈ 0.136
--   --   (read-only rehearsal 2026-09-09 09:1x UTC: 1,420 cells, 54 with n ≥ 200)
--   SELECT count(*) AS open_events, count(cell_key) AS with_key FROM dark_contact_open_for_claims;  -- equal
--   SELECT has_function_privilege('anon', 'public.dark_contact_issuance_plan(integer,integer,numeric,numeric)', 'EXECUTE') AS plan_anon,
--          has_function_privilege('anon', 'public.dark_contact_cell_report(integer,numeric)', 'EXECUTE') AS report_anon,
--          has_table_privilege('anon', 'public.dark_contact_open_for_claims', 'SELECT') AS view_anon,
--          has_function_privilege('service_role', 'public.dark_contact_cell_report(integer,numeric)', 'EXECUTE') AS report_service;
--   --   false · false · false · true
--   SELECT at, pr, note FROM ledger_change_log ORDER BY at DESC LIMIT 1;           -- this change
--   -- mig-143 AUDIT — anon-executable VOLATILE application functions — must return ZERO rows:
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.provolatile = 'v' AND p.prokind = 'f'
--     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
--     AND has_function_privilege('anon', p.oid, 'EXECUTE');
