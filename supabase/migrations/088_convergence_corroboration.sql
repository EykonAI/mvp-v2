-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 088 · Convergence corroboration + thermal as a domain
--
-- Two changes, one idea: a convergence is only as strong as the
-- INDEPENDENCE of the signals that make it.
--
-- 1 · CORROBORATION LEVEL on convergence_events.
--     compute-convergences fires when a spatial cell holds ≥2 distinct
--     `domain` values. But Conflict (ACLED) and Energy (GDELT) are both
--     MEDIA-derived — a single news wave lights up both, so two "domains"
--     can be one source of evidence wearing two hats. The old score
--     (0.3 / flag_count) rewarded that redundancy: more correlated flags
--     → smaller p → LOOKED more significant. Backwards.
--
--     Thermal (FIRMS radiometry) and Maritime (AIS) are PHYSICALLY
--     independent witnesses — a satellite hot pixel and a vessel track do
--     not move together with a headline. Those are the signals that turn
--     "the news says X" into "our sensors agree." This migration records,
--     per convergence, how independent its evidence actually is:
--       single-source   — all contributing domains share one source class
--       multi-source    — ≥2 independent source classes, none a sensor
--       sensor-confirmed — ≥2 independent classes AND ≥1 physical sensor
--     The scoring change lives in the engine (compute-convergences);
--     these columns let every surface show the honest label.
--
-- 2 · firms_significant_events_located(p_periods) — a read-only helper so
--     the significance cron can emit a Thermal anomaly_flag per event.
--     firms_significant_events stores facility_type + facility_id but no
--     coordinates; the convergence engine bins on payload.latitude/
--     longitude. This joins each event to firms_monitored_facilities
--     (the same view 085 already trusts for coverage) to attach lat/lon,
--     so thermal becomes a first-class convergence domain without
--     denormalising coordinates onto the events table.
--
-- Additive and backfill-safe: existing convergence_events rows keep a
-- NULL corroboration_level (they predate the label) and read as
-- "unknown" everywhere. Apply MANUALLY in the Supabase SQL Editor
-- BEFORE merge (Railway auto-deploys main).
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Corroboration columns ─────────────────────────────────
ALTER TABLE convergence_events
  ADD COLUMN IF NOT EXISTS corroboration_level text
    CHECK (corroboration_level IN ('single-source', 'multi-source', 'sensor-confirmed')),
  ADD COLUMN IF NOT EXISTS source_classes jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN convergence_events.corroboration_level IS
  'How independent the contributing evidence is. single-source = all '
  'domains share one source class (e.g. ACLED+GDELT, both media); '
  'multi-source = ≥2 independent classes; sensor-confirmed = ≥2 classes '
  'incl. a physical sensor (FIRMS thermal / AIS maritime). NULL = pre-088.';

COMMENT ON COLUMN convergence_events.source_classes IS
  'Distinct independent source classes among contributing domains, e.g. '
  '["media","sensor-firms"]. The count of these — not the raw flag count '
  '— drives joint_p_value from 088 onward.';

-- ─── 2 · Located significance events (read-only helper) ─────────
-- Attaches facility coordinates to significant thermal events so the
-- significance cron can write a geolocated Thermal anomaly_flag.
-- STABLE + SECURITY DEFINER: firms_monitored_facilities and
-- firms_significant_events are service-role only (085); this exposes a
-- narrow, read-only projection to the cron's server client.
CREATE OR REPLACE FUNCTION firms_significant_events_located(p_periods date[])
RETURNS TABLE (
  facility_type    text,
  facility_id      text,
  facility_name    text,
  country          text,
  period           date,
  event_type       text,
  observed_count   int,
  observed_max_frp numeric,
  baseline_days    int,
  baseline_rate    numeric,
  deviation        numeric,
  dark_days        int,
  latitude         double precision,
  longitude        double precision
) AS $$
  SELECT e.facility_type, e.facility_id, e.facility_name, e.country,
         e.period, e.event_type, e.observed_count, e.observed_max_frp,
         e.baseline_days, e.baseline_rate, e.deviation, e.dark_days,
         m.latitude, m.longitude
    FROM firms_significant_events e
    LEFT JOIN firms_monitored_facilities m
      ON m.facility_type = e.facility_type
     AND m.facility_id   = e.facility_id
   WHERE e.period = ANY (p_periods);
$$ LANGUAGE sql STABLE SECURITY DEFINER;
