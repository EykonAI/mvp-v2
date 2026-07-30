-- ═══════════════════════════════════════════════════════════════
-- eYKON.ai — 091 · Black Marble (VIIRS VNP46A2) facility radiance
--
-- A THIRD independent physical sensor. FIRMS sees heat; AIS sees
-- vessels; Black Marble sees LIGHT — moonlight/atmosphere-corrected
-- nighttime radiance at ~500 m. A facility (or the grid around it)
-- whose radiance collapses below its own clear-night baseline for
-- several confidently-clear nights is a probable power outage — an
-- outage signal from independent physics that can corroborate a
-- FIRMS went_dark. Two sensors agreeing is the strongest possible
-- `sensor-confirmed` convergence (088).
--
-- ─── HONESTY INVARIANTS (mirror FIRMS — they ARE the product) ──────
-- • Radiance is not power state. Cloud, moon, snow and viewing
--   geometry dominate raw DNB. Every reading carries its quality
--   ingredients (Mandatory_Quality_Flag + cloud confidence + shadow/
--   cirrus/snow) so a reader can judge the claim, not trust a label.
-- • A row exists IFF the facility's tile was processed that night —
--   coverage by construction, exactly like 085. No row = nobody
--   looked. Row with radiance NULL = we looked, no usable retrieval.
--   Absence of light is only meaningful on a CONFIDENTLY CLEAR,
--   quality-flagged night.
-- • THE GAP-FILLED BAND IS BANNED. VNP46A2 also ships
--   Gap_Filled_DNB_BRDF-Corrected_NTL, which back-fills cloudy nights
--   from historical radiance. During a real outage under cloud it
--   would report the facility's HISTORICAL brightness — fabricating
--   exactly the light whose disappearance we exist to detect. The
--   worker reads DNB_BRDF-Corrected_NTL only.
-- • A dark night is not an outage. Significance (a later migration)
--   will require sustained departure from the facility's OWN
--   clear-night baseline — deviation, not presence/absence.
--
-- Roster: the facilities FIRMS is already watching (distinct
-- facilities in firms_facility_observations over a trailing window),
-- so the two sensors observe the SAME set and corroboration joins
-- 1:1 on (facility_type, facility_id). No second region config to
-- drift out of sync.
--
-- Additive. RLS ON, service-role only. Apply MANUALLY in the
-- Supabase SQL Editor BEFORE merge (Railway auto-deploys main).
-- ═══════════════════════════════════════════════════════════════

-- ─── 1 · Nightly facility radiance ─────────────────────────────
CREATE TABLE IF NOT EXISTS blackmarble_facility_radiance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_type     text NOT NULL,
  facility_id       text NOT NULL,
  facility_name     text,
  country           text,
  -- The NASA A-date of the night (VNP46A2.AYYYYDDD…). One row per
  -- facility per night.
  period            date NOT NULL,

  -- Radiance in nW·cm⁻²·sr⁻¹ (scale 0.1 already applied). NULL when
  -- the pixel had no high-quality retrieval that night (fill value or
  -- Mandatory_Quality_Flag = poor/no-retrieval). NULL is "no usable
  -- look", never zero.
  radiance          numeric,
  -- Mean over the 3×3 pixel window (~1.5 km) centred on the facility,
  -- over high-quality pixels only; NULL when none. Guards against a
  -- point coordinate landing one pixel off the plant.
  radiance_3x3      numeric,
  -- How many of the (≤9) window pixels were high-quality that night.
  px_hq_3x3         int NOT NULL DEFAULT 0,

  -- Quality ingredients, stored raw so every downstream claim is
  -- auditable against what the sensor actually said.
  mandatory_quality smallint,     -- 0 high-persistent · 1 high-ephemeral · 2 poor · 255 no retrieval
  cloud_confidence  text,         -- confident_clear | probably_clear | probably_cloudy | confident_cloudy
  shadow            boolean,
  cirrus            boolean,
  snow              boolean,

  tile              text NOT NULL,          -- e.g. h20v04 — which granule this came from
  computed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_type, facility_id, period)
);

CREATE INDEX IF NOT EXISTS idx_bm_radiance_period
  ON blackmarble_facility_radiance (period DESC);
CREATE INDEX IF NOT EXISTS idx_bm_radiance_facility
  ON blackmarble_facility_radiance (facility_type, facility_id, period DESC);

COMMENT ON TABLE blackmarble_facility_radiance IS
  'Nightly VIIRS Black Marble (VNP46A2) radiance sampled at FIRMS-watched facilities. Row exists iff the tile was processed that night (coverage by construction); radiance NULL = watched but no high-quality retrieval. Non-gap-filled band only. See services/blackmarble-ingest.';

-- ─── 2 · Ingest runs (coverage + liveness record) ──────────────
-- One row per processed night, upserted on rescan. This is what the
-- ingest-health surface and a future liveness probe read — the same
-- role firms_ingest_runs plays for the thermal shards.
CREATE TABLE IF NOT EXISTS blackmarble_ingest_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  night              date NOT NULL UNIQUE,
  tiles_expected     int  NOT NULL,
  tiles_processed    int  NOT NULL,
  -- Tiles not yet published by NASA (VNP46A2 lags days behind).
  -- Missing ≠ failed: the night stays pending and the rescan window
  -- picks it up on a later run.
  tiles_missing      int  NOT NULL,
  facilities_written int  NOT NULL,
  ok                 boolean NOT NULL,
  error              text,
  ran_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE blackmarble_ingest_runs IS
  'Per-night Black Marble ingest record: which nights were processed, how many tiles NASA had published, how many facility rows were written. Missing tiles = NASA latency (pending), not failure. See services/blackmarble-ingest.';

-- ─── RLS: service-role only, like every operational table ──────
ALTER TABLE blackmarble_facility_radiance ENABLE ROW LEVEL SECURITY;
ALTER TABLE blackmarble_ingest_runs       ENABLE ROW LEVEL SECURITY;
-- No policies, deliberately: no user-facing read path yet. The
-- workspace/API layer decides later what to expose, with honest
-- labels.
