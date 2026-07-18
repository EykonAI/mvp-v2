-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 086 · FIRMS proximity tagging + tiered retention
--
-- Companion to 085. Apply 085 FIRST, then this, back to back, in the
-- same SQL Editor session — see section 0 for why the gap matters.
--
-- ─── WHAT A DETECTION IS (unchanged, do not soften) ────────────
-- A FIRMS row is a THERMAL ANOMALY DETECTION — a hot pixel measured
-- by a satellite radiometer. Not a fire, not an explosion, not a
-- strike. Proximity to a facility is GEOMETRY, not attribution: a
-- detection 2 km from a refinery may be a field fire, a flare stack
-- doing its job, or a burning car park. This migration decides what
-- we STORE, and makes no claim about what anything MEANS.
--
-- ═══════════════════════════════════════════════════════════════
-- ─── 0 · BUG FIX · 085 creates an OVERLOAD, not a replacement ──
-- ═══════════════════════════════════════════════════════════════
-- 085 does:
--     CREATE OR REPLACE FUNCTION firms_derive_facility_observations(
--       p_day date, p_radius_km numeric, p_min_mw numeric,
--       p_regions jsonb DEFAULT NULL)
--
-- PostgreSQL identifies a function by (name, ARGUMENT TYPES). The
-- pre-085 function has three parameters; the 085 body has four. The
-- signatures differ, so CREATE OR REPLACE does NOT replace the old
-- one — it creates a SECOND, overloaded function. Verified against
-- production 2026-07-18 (085 not yet applied there):
--     firms_derive_facility_observations(p_day date,
--         p_radius_km numeric, p_min_mw numeric)   <- still 3 args
--
-- Consequence, and it is not cosmetic. After 085 alone:
--   • The old worldwide, unrestricted 3-arg rollup is STILL CALLABLE
--     and still live. The P0 that 085 exists to fix is only half
--     fixed — the honest 4-arg path is added, the dishonest 3-arg
--     path is not removed.
--   • Worse, a 3-arg call becomes AMBIGUOUS. Both candidates match
--     (the 4-arg one via its default), the argument types are
--     identical, so nothing breaks the tie and the parser raises
--     "function ... is not unique". This is documented behaviour —
--     the CREATE FUNCTION reference warns about exactly this pattern.
--     The currently-deployed cron on main calls it with 3 args, so
--     from the moment 085 is applied until the new route ships, the
--     hourly ingest 500s on every tick.
--
-- Fix: drop the stale 3-arg signature. IF EXISTS so this is a no-op
-- if it has already gone. DROP matches DECLARED argument types only,
-- so this cannot touch the 4-arg function 085 installed.
--
-- Operational note: apply 085 and 086 together, then merge. The
-- window between them is the only period where the ingest is broken.
DROP FUNCTION IF EXISTS firms_derive_facility_observations(date, numeric, numeric);

-- ═══════════════════════════════════════════════════════════════
-- ─── 1 · THE VOLUME PROBLEM ────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════
-- Founder scope (2026-07-18): only thermal activity with geopolitical
-- or strong economic/financial impact is of interest. Agricultural and
-- crop burning is explicitly NOT — and it is the overwhelming majority
-- of global detections, concentrated exactly where we want to expand
-- (South and SE Asia).
--
-- Measured against production, 2026-07-18, over the 11,746 detections
-- currently held for the THREE EXISTING regions (ru-ua, gulf, europe —
-- already among the most infrastructure-dense land on earth):
--
--     within  5 km of a monitored facility →    770   ( 6.6%)
--     within  8 km                         →  1,038   ( 8.8%)
--     within 10 km                         →  1,219   (10.4%)
--     within 15 km                         →  1,641   (14.0%)
--
-- So ~91% of what we already ingest is noise by the founder's
-- definition. Globally that fraction gets worse, not better.
--
-- "Monitored" here is the SAME set the 085 rollup uses:
--   refineries with geom (634) + power_plants with geom and
--   capacity_mw >= p_min_mw (12,628 at 500 MW) = 13,262.
-- Verified: refineries 634/634 have geom, power_plants
-- 182,417/182,417 have geom, capacity_mw NULL on 0 rows (the 082
-- backfill held).
--
-- NOTE the view firms_monitored_facilities is NOT used here: it
-- carries no geom column and applies no capacity floor (183,051 rows,
-- i.e. every wind turbine and rooftop array). Filtering on that set
-- would retain most of the inhabited world and control nothing.
--
-- ─── 2 · WHY TAG-AND-PRUNE RATHER THAN DISCARD-ON-WRITE ────────
-- The globe layer (/api/firms, PR #287) renders RAW detections in the
-- viewport. Hard-discarding non-proximate rows at ingest would empty
-- it — 91% of its points are exactly the rows we want out of the
-- analytical pipeline.
--
-- So: every detection is still written, then TAGGED, then pruned on
-- a two-tier schedule. The analytical pipeline (rollup, significance,
-- alerts) is unaffected either way, because it re-derives from
-- geometry; only the globe cares about the untagged majority, and it
-- asks for 48 h by default.
--
-- Hard discard is still reachable without a code change: set the raw
-- retention to 0 days and the prune runs in the same request that
-- wrote the rows, so non-proximate detections never outlive the
-- ingest. That is the knob to turn once the globe has another source.
--
-- Additive. RLS unchanged. Apply MANUALLY before merge.
-- ═══════════════════════════════════════════════════════════════

-- ─── 3 · The tag ───────────────────────────────────────────────
-- Three-state on purpose:
--   TRUE  — within the ingest radius of a monitored facility
--   FALSE — evaluated, and not
--   NULL  — NOT YET EVALUATED
-- NULL must never be conflated with FALSE. A row is NULL when the
-- tagging RPC has not run or failed, and deleting NULLs as though
-- they were noise would silently destroy analytical data on the one
-- day the tagger was broken. Section 5 re-tags NULLs before pruning
-- for exactly this reason.
ALTER TABLE firms_thermal_anomalies
  ADD COLUMN IF NOT EXISTS facility_proximate boolean;

COMMENT ON COLUMN firms_thermal_anomalies.facility_proximate IS
  'TRUE when this detection lies within the ingest proximity radius of a monitored facility (refinery, or power plant above the capacity floor). FALSE when evaluated and outside. NULL when not yet evaluated — never treat NULL as FALSE. Geometry only: this is not an attribution of the detection to the facility.';

-- Retention scans and the globe''s proximate-only mode both filter on
-- (acq_date, facility_proximate). Partial index on the pruneable set
-- keeps the delete cheap as the table grows to global volume.
CREATE INDEX IF NOT EXISTS firms_anom_prune_idx
  ON firms_thermal_anomalies (acq_date)
  WHERE facility_proximate IS NOT TRUE;

CREATE INDEX IF NOT EXISTS firms_anom_proximate_idx
  ON firms_thermal_anomalies (acq_date DESC)
  WHERE facility_proximate;

-- ─── 4 · Tagging RPC ───────────────────────────────────────────
-- Tags only rows still NULL, so it is cheap to call every tick and
-- idempotent. Driven from the detection side with EXISTS against the
-- base tables, which is what lets the functional geography GIST
-- indexes from 083 (refineries_geog_idx, power_plants_geog_idx) do
-- the work. Measured on production: the equivalent query over 11,746
-- detections × 13,262 facilities returns in a few seconds. Note it is
-- deliberately NOT written as a join against a UNION ALL CTE of the
-- two tables — that form materialises the facility set, loses both
-- indexes, degrades to a ~155M-pair nested loop, and timed out when
-- tried against production.
--
-- p_min_mw MUST match the rollup's floor or the two disagree about
-- what "monitored" means. The route passes one TypeScript constant to
-- both.
CREATE OR REPLACE FUNCTION firms_tag_facility_proximity(
  p_since     date,
  p_radius_km numeric DEFAULT 8,
  p_min_mw    numeric DEFAULT 500
) RETURNS int AS $$
DECLARE
  v_rows int;
BEGIN
  UPDATE firms_thermal_anomalies f
     SET facility_proximate = (
           EXISTS (
             SELECT 1 FROM refineries r
              WHERE r.geom IS NOT NULL
                AND ST_DWithin(r.geom::geography, f.geom::geography,
                               p_radius_km * 1000)
           )
           OR EXISTS (
             SELECT 1 FROM power_plants p
              WHERE p.geom IS NOT NULL
                AND p.capacity_mw >= p_min_mw
                AND ST_DWithin(p.geom::geography, f.geom::geography,
                               p_radius_km * 1000)
           )
         )
   WHERE f.facility_proximate IS NULL
     AND f.geom IS NOT NULL
     AND f.acq_date >= p_since;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql;

-- ─── 5 · Retention RPC ─────────────────────────────────────────
-- WHAT IS DELETED, EXPLICITLY:
--   • Non-proximate detections older than p_raw_days. These exist
--     only to draw the globe layer, which defaults to a 48 h window.
--   • Proximate detections older than p_proximate_days. Long, because
--     the 085 significance baseline is a trailing 30-day window and
--     year-over-year seasonality is the obvious next question.
--
-- WHAT IS KEPT FOREVER, and is NOT touched here:
--   • firms_facility_observations — the per-facility daily rollup.
--     This is the durable analytical record and the resolver's
--     evidence base. Deleting a row would retroactively turn a
--     measured "we watched, nothing" into "no data", which is the
--     precise dishonesty 085 was written to eliminate.
--   • firms_significant_events — the derived event record.
--   • firms_ingest_runs — the coverage ledger. Small, and it is the
--     only thing that makes an absence interpretable.
--
-- Re-tags NULL rows inside the retention window BEFORE deleting, so a
-- tick where the tagger failed cannot cause proximate detections to
-- be pruned as though they were noise.
CREATE OR REPLACE FUNCTION firms_prune_thermal_anomalies(
  p_raw_days       int     DEFAULT 3,
  p_proximate_days int     DEFAULT 365,
  p_radius_km      numeric DEFAULT 8,
  p_min_mw         numeric DEFAULT 500
) RETURNS jsonb AS $$
DECLARE
  v_retagged int;
  v_raw      int;
  v_old      int;
BEGIN
  -- Self-heal before destroying anything.
  v_retagged := firms_tag_facility_proximity(
                  CURRENT_DATE - GREATEST(p_raw_days, 0) - 1,
                  p_radius_km, p_min_mw);

  -- Tier A · raw, globe-only.
  DELETE FROM firms_thermal_anomalies
   WHERE acq_date < CURRENT_DATE - GREATEST(p_raw_days, 0)
     AND facility_proximate IS FALSE;
  GET DIAGNOSTICS v_raw = ROW_COUNT;

  -- Tier B · everything past the long horizon, proximate included.
  DELETE FROM firms_thermal_anomalies
   WHERE acq_date < CURRENT_DATE - GREATEST(p_proximate_days, 1);
  GET DIAGNOSTICS v_old = ROW_COUNT;

  RETURN jsonb_build_object(
    'retagged',        v_retagged,
    'deleted_raw',     v_raw,
    'deleted_expired', v_old,
    'raw_days',        p_raw_days,
    'proximate_days',  p_proximate_days
  );
END;
$$ LANGUAGE plpgsql;

-- ─── 6 · Backfill the rows already held ────────────────────────
-- 11,746 rows across 2026-07-17..18 as of writing. Bounded and cheap.
SELECT firms_tag_facility_proximity('1970-01-01'::date, 8, 500);

-- ─── 7 · Grants ────────────────────────────────────────────────
-- Service role only. These mutate; nothing anonymous may reach them.
REVOKE ALL ON FUNCTION firms_tag_facility_proximity(date, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION firms_tag_facility_proximity(date, numeric, numeric) TO service_role;

REVOKE ALL ON FUNCTION firms_prune_thermal_anomalies(int, int, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION firms_prune_thermal_anomalies(int, int, numeric, numeric) TO service_role;
