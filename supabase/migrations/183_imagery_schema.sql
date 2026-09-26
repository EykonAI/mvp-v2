-- ═══════════════════════════════════════════════════════════════════════
-- eYKON.ai — 183 · Imagery Layer schema: licences, AOIs, observations,
--             webcams (Imagery Layer build prompt rev A, IMG-1)
--
-- PURPOSE
-- The schema every later imagery PR writes into. Nothing here fetches an
-- image, spends a processing unit or shows anything to a user: the AOIs
-- are seeded with sensors_enabled = '{}', so the first pixel is paid for
-- in IMG-2, not here.
--
--   1 · imagery_licences — one row per imagery / webcam provider, carrying
--       its commercial-use status from the feed register (Google Sheet,
--       2026-09-26). The register is the gate (build prompt §0.3): a
--       webcam cannot be made live, and no observation can be stored,
--       under a provider whose licence forbids it — enforced by trigger.
--
--   2 · imagery_aois — the only list of places eYKON looks at from orbit.
--       Seeded from registries that already exist, never typed by hand:
--         refinery_complex  active refinery_complexes (RFC- keys, mig 160);
--                           footprint = convex hull of CURRENT members,
--                           buffered 1,000 m on the geography
--         lng_terminal      lng_terminals grouped by project_id (a terminal
--                           is a site; its units are rows — count sites),
--                           status 'operating', buffered 1,500 m
--         port              ports with harbor_size L or M, buffered 2,000 m
--         mine              mines_curated with coordinates (mig 080),
--                           rows at one coordinate = one site (heavy-REE
--                           mines appear once per workspace), buffered
--                           2,000 m (the Sentinel cron's ~2 km box)
--       Anchorages, chokepoints and datacentres are allowed kinds but are
--       NOT seeded: anchorages are drawn from AIS dwell clusters in IMG-3,
--       datacentres wait on founder decision F-5.
--       imagery_aois_sync() is the one writer; it inserts new sites,
--       retires AOIs whose source disappeared, and refreshes a footprint
--       ONLY while no observation exists for it.
--
--   3 · imagery_observations — one row per AOI × sensor × acquisition that
--       eYKON LOOKED at, whether or not it saw anything. VOID semantics are
--       CHECKs, not conventions:
--         · a value exists only on a 'clear' look (anything else is VOID);
--         · a 'clear' optical look must say how cloudy the AOI was;
--         · SAR has no cloud fraction;
--         · 'clear' means the acquisition covered ≥ 99% of the AOI;
--         · the statistic is never a mean (brief §16.13: means
--           manufacture collapses) — median, count, area or fraction;
--         · a baseline is stored with its n, or not at all.
--
--   4 · webcams + webcam_liveness — the camera registry and its fetch log.
--       upstream_url lives in a service-role-only table and is never sent
--       to a client (the Argos Atlas relay exposes it in base64; eYKON
--       resolves an opaque webcam_id server-side). is_live requires an 'ok'
--       licence (trigger).
--
-- FROZEN FOOTPRINTS. Once an observation exists for an AOI its polygon can
-- no longer change (trigger): a baseline measured over one outline is not
-- comparable with a value measured over another.
--
-- ACCESS. RLS on, no policy, REVOKE by role name (on Supabase REVOKE FROM
-- PUBLIC alone revokes nothing that matters — brief rev T), service_role
-- only. Additive: no existing table or function is altered.
--
-- APPLY: manually in the Supabase SQL Editor, BEFORE merge, whole file in
-- one paste. Then run supabase/tests/img1_guards.sql; its last statement
-- returns ONE result row — that row is the pass signal.
-- Replayed end to end under PGlite 0.5.8 + PostGIS 3.6 before hand-off.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1 · Licences ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.imagery_licences (
  provider_id        text        PRIMARY KEY,
  provider_name      text        NOT NULL,
  feed_kind          text        NOT NULL,
  commercial_status  text        NOT NULL,
  attribution_text   text,
  terms_url          text,
  pricing_url        text,
  price_note         text,
  register_row       text,          -- ID in the feed register sheet (A01…, B01…)
  cleared_by         text,
  cleared_at         timestamptz,
  notes              text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT il_provider_id_format CHECK (provider_id ~ '^[a-z0-9_]+$'),
  CONSTRAINT il_feed_kind CHECK (feed_kind IN
    ('satellite_open','satellite_commercial','satellite_sar','basemap','weather_satellite','webcam')),
  CONSTRAINT il_status CHECK (commercial_status IN
    ('ok','licence_needed','confirm_in_writing','unclear','forbidden','excluded')),
  -- 'ok' is only 'ok' with the credit that makes it so (build prompt §0.3)
  CONSTRAINT il_ok_needs_attribution CHECK
    (commercial_status <> 'ok' OR length(coalesce(attribution_text, '')) > 0),
  CONSTRAINT il_clearance_pair CHECK ((cleared_by IS NULL) = (cleared_at IS NULL))
);

COMMENT ON TABLE public.imagery_licences IS
  'IMG-1 (mig 183). One row per imagery/webcam provider with its commercial-use status for a paid SaaS, read from the feed register (2026-09-26). The register is the gate: triggers refuse a live webcam or a stored observation under a provider whose status forbids it. A status is changed only by recording who cleared it and when.';

INSERT INTO public.imagery_licences
  (provider_id, provider_name, feed_kind, commercial_status, attribution_text, terms_url, pricing_url, price_note, register_row, notes)
VALUES
  ('copernicus_cdse', 'Copernicus Data Space Ecosystem (Sentinel-1/-2 via Sentinel Hub APIs)', 'satellite_open', 'ok',
   'Contains modified Copernicus Sentinel data {year}',
   'https://documentation.dataspace.copernicus.eu/Quotas.html', 'https://documentation.dataspace.copernicus.eu/Quotas.html',
   'Free: 10,000 PU/month, 50,000 requests/month', 'B01', 'Already used by ingest-sentinel-tiles (mig 080).'),
  ('sentinel_hub_planet', 'Sentinel Hub commercial plans (Planet Insights Platform)', 'satellite_open', 'ok',
   'Contains modified Copernicus Sentinel data {year}',
   'https://docs.planet.com', 'https://creodias.eu/pricing/sh-pricing/',
   'Basic €999/yr (70k PU/month); Enterprise-S €5,000/yr; Enterprise-L €10,000/yr — CREODIAS page, confirm with Planet', 'B02',
   'Exploration plan is non-commercial; Basic or above only.'),
  ('nasa_gibs', 'NASA GIBS / Worldview WMTS', 'satellite_open', 'ok',
   'Imagery provided by services from NASA''s Global Imagery Browse Services (GIBS), part of NASA''s ESDIS',
   'https://nasa-gibs.github.io/gibs-api-docs/', NULL, 'Free', 'B03',
   'True colour only. The GIBS night-lights raster stays deferred (brief §17.3).'),
  ('usgs_landsat', 'USGS Landsat 8/9', 'satellite_open', 'ok',
   'Source: U.S. Geological Survey', 'https://www.usgs.gov/landsat-missions/landsat-data-access', NULL, 'Free (public domain)', 'B04', NULL),
  ('noaa_goes_aws', 'NOAA GOES-18/19 on AWS Open Data', 'weather_satellite', 'ok',
   'NOAA GOES imagery via the NOAA Open Data Dissemination program', 'https://registry.opendata.aws/noaa-goes/', NULL, 'Free', 'B05',
   'Use the AWS buckets, not the NESDIS STAR site (informational only).'),
  ('jma_himawari_aws', 'JMA Himawari on AWS Open Data', 'weather_satellite', 'ok',
   'Himawari imagery: Japan Meteorological Agency, via NOAA Open Data Dissemination', 'https://registry.opendata.aws/noaa-himawari/', NULL, 'Free', 'B05',
   'The NICT Himawari viewer is NON-commercial; only the AWS copy is used.'),
  ('eumetsat_view', 'EUMETSAT View WMS (Meteosat IR mosaic)', 'weather_satellite', 'confirm_in_writing',
   '© EUMETSAT {year}', 'https://www.eumetsat.int/legal-framework/data-policy', NULL, 'No public price — quote', 'A16',
   'WMS capabilities say Fees=none; site terms say personal/non-commercial. Founder email F-4.'),
  ('esri_location_platform', 'Esri World Imagery via ArcGIS Location Platform', 'basemap', 'licence_needed',
   'Imagery © Esri, Maxar, Earthstar Geographics', 'https://location.arcgis.com/pricing/', 'https://location.arcgis.com/pricing/',
   '2M basemap tiles/month free, then $0.15 per 1,000', 'A15', 'Needs an API key (founder decision F-2). Display only.'),
  ('maptiler_satellite', 'MapTiler Satellite', 'basemap', 'licence_needed',
   '© MapTiler © OpenStreetMap contributors', 'https://www.maptiler.com/cloud/pricing/', 'https://www.maptiler.com/cloud/pricing/',
   'Free tier non-commercial; Flex $30/month', 'B20', 'Alternative to Esri (F-2). Display only.'),
  ('mapbox_satellite', 'Mapbox Satellite', 'basemap', 'licence_needed',
   '© Mapbox © Maxar', 'https://www.mapbox.com/pricing', 'https://www.mapbox.com/pricing',
   '750k raster tiles/month free, then $0.25 → $0.15 per 1,000', 'B18', 'DISPLAY ONLY — no analytics, no AI/ML, no feature tracing.'),
  ('google_map_tiles', 'Google Map Tiles API (2D satellite / Photorealistic 3D)', 'basemap', 'licence_needed',
   'Map data: Google', 'https://developers.google.com/maps/billing-and-pricing/pricing', 'https://developers.google.com/maps/billing-and-pricing/pricing',
   '2D: 100k/month free, then $0.60 per 1,000', 'B19', 'DISPLAY ONLY — no image analysis or object detection.'),
  ('umbra', 'Umbra SAR (Canopy + Open Data)', 'satellite_sar', 'ok',
   'Umbra Space, CC BY 4.0', 'https://umbra.space/pricing', 'https://umbra.space/pricing',
   'Spotlight 5×5 km $675–$2,200', 'B07', 'Paid and open data under CC BY 4.0. Purchases only after one founder-bought look (IMG-11).'),
  ('satellogic', 'Satellogic (Aleph)', 'satellite_commercial', 'licence_needed',
   NULL, 'https://satellogic.com/products/multispectral-imagery/', 'https://satellogic.com/products/multispectral-imagery/',
   'Archive $4/km² (min 4 km²); public-release licence +200%', 'B11', NULL),
  ('up42', 'UP42 marketplace', 'satellite_commercial', 'licence_needed',
   NULL, 'https://up42.com/pricing', 'https://up42.com/pricing', '100 credits = €1; minimum €100', 'B16', 'Per-provider EULA.'),
  ('global_fishing_watch', 'Global Fishing Watch APIs (Sentinel-1 vessel detections)', 'satellite_sar', 'forbidden',
   'Powered by Global Fishing Watch', 'https://globalfishingwatch.org/our-apis/documentation', NULL, 'Free, CC BY-NC 4.0', 'B10',
   'Non-commercial only; commercial terms by direct negotiation (F-4).'),
  ('windy_webcams', 'Windy Webcams API', 'webcam', 'licence_needed',
   'Webcams provided by windy.com', 'https://api.windy.com/webcams/docs', 'https://api.windy.com/webcams/pricing',
   'Professional €9,990/year', 'A01', 'Free tier may not be used only inside a paid product (founder decision F-1).'),
  ('tfl_jamcams', 'Transport for London JamCams', 'webcam', 'ok',
   'Powered by TfL Open Data. Contains OS data © Crown copyright and database rights', 'https://api.tfl.gov.uk/Place/Type/JamCam', NULL, 'Free (key)', 'B21', NULL),
  ('hk_td', 'Hong Kong Transport Department traffic snapshots', 'webcam', 'ok',
   'Source: Transport Department, HKSAR Government (DATA.GOV.HK)', 'https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images', NULL, 'Free', 'B22', NULL),
  ('sg_lta', 'Singapore LTA DataMall traffic images', 'webcam', 'ok',
   'Contains information from LTA DataMall accessed under the Singapore Open Data Licence', 'https://datamall.lta.gov.sg', NULL, 'Free (AccountKey)', 'B23', 'Image links expire after 15 minutes.'),
  ('quebec_511', 'Québec 511 traffic cameras', 'webcam', 'ok',
   'Source: Ministère des Transports du Québec, Données Québec (CC BY 4.0)', 'https://www.donneesquebec.ca', NULL, 'Free', 'B24', NULL),
  ('caltrans_cctv', 'Caltrans CCTV (cwwp2)', 'webcam', 'ok',
   'Source: California Department of Transportation (Caltrans)', 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm', NULL, 'Free', 'A02', NULL),
  ('usgs_ashcam', 'USGS volcano webcams (AshCam, non-FAA cameras only)', 'webcam', 'ok',
   'Source: U.S. Geological Survey', 'https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams', NULL, 'Free', 'A07',
   'FAA-flagged cameras are NOT covered by this row.'),
  ('us_511_platform', 'US/Canada 511 platform (511NY, Georgia, Louisiana, Ontario) and Ohio OHGO', 'webcam', 'unclear',
   NULL, 'https://511ny.org/developers', NULL, 'Free (developer key)', 'A02', 'Developer agreements do not state commercial terms.'),
  ('taiwan_tdx', 'Taiwan TDX (Freeway Bureau / THB CCTV)', 'webcam', 'ok',
   '資料來源：交通部 TDX 平臺', 'https://tdx.transportdata.tw/api-service/swagger', 'https://tdx.transportdata.tw/pricing',
   '~3,000 calls/month free, then NT$ plans (partly UNVERIFIED)', 'A06', 'TDX logo required beside the credit.'),
  ('dgt_spain', 'DGT Spain traffic cameras (NAP DATEX II)', 'webcam', 'confirm_in_writing',
   NULL, 'https://nap.dgt.es/dataset/camaras-dgt-datex2-v3-7', NULL, 'Free', 'A03', 'Linked legal notice forbids unauthorised commercialisation (F-4).'),
  ('jp_mlit_river', 'Japan MLIT river cameras', 'webcam', 'licence_needed',
   '出典：国土交通省 川の防災情報', 'https://www.river.go.jp', 'https://www.river.or.jp/koeki/opendata/',
   'Bulk feed fee-based — quote', 'A05', 'Scheduled scraping of the web site is prohibited; paid feed only.'),
  ('youtube_embed', 'YouTube live streams (official embedded player)', 'webcam', 'unclear',
   NULL, 'https://developers.google.com/youtube/terms/developer-policies', NULL, '$0 (Data API quota)', 'A11',
   'Official player only; no own ads on YouTube content; API data refreshed or deleted within 30 days.'),
  ('earthcam', 'EarthCam', 'webcam', 'licence_needed', NULL, 'https://www.earthcam.com/company/contact.php?license', NULL, 'Quote', 'B25', NULL),
  ('skylinewebcams', 'SkylineWebcams', 'webcam', 'licence_needed', NULL, 'https://www.skylinewebcams.com/en/terms-of-use.html', NULL, 'Quote', 'B26', NULL),
  ('liveatc', 'LiveATC.net (ATC audio)', 'webcam', 'forbidden', NULL, NULL, NULL, NULL, 'A23', 'Not for third-party products.'),
  ('unsecured_ip_cams', 'Insecam / Shodan-class unsecured private cameras', 'webcam', 'excluded', NULL, NULL, NULL, NULL, 'B27',
   'Never ingest — privacy law and computer-misuse risk.')
ON CONFLICT (provider_id) DO NOTHING;

-- ─── 2 · AOIs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.imagery_aois (
  aoi_id           text        PRIMARY KEY,
  kind             text        NOT NULL,
  source_table     text,
  source_id        text,
  name             text,
  country_iso      text,
  geom             geometry(Polygon, 4326) NOT NULL,
  centroid_lat     double precision NOT NULL,
  centroid_lon     double precision NOT NULL,
  area_km2         double precision NOT NULL,
  buffer_rule      text        NOT NULL,
  sensors_enabled  text[]      NOT NULL DEFAULT '{}',
  priority         smallint    NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  retired_at       timestamptz,
  retired_reason   text,
  CONSTRAINT ia_kind CHECK (kind IN
    ('refinery_complex','lng_terminal','port','mine','anchorage','chokepoint','datacentre')),
  CONSTRAINT ia_id_format CHECK (aoi_id = kind || ':' || source_id OR (source_id IS NULL AND aoi_id ~ ('^' || kind || ':[A-Za-z0-9_.-]+$'))),
  CONSTRAINT ia_source_pair CHECK ((source_table IS NULL) = (source_id IS NULL)),
  CONSTRAINT ia_country_iso CHECK (country_iso IS NULL OR country_iso ~ '^[A-Z]{2}$'),
  CONSTRAINT ia_centroid_range CHECK (centroid_lat BETWEEN -90 AND 90 AND centroid_lon BETWEEN -180 AND 180),
  CONSTRAINT ia_area_sane CHECK (area_km2 > 0 AND area_km2 < 2500),
  CONSTRAINT ia_sensors_known CHECK (sensors_enabled <@ ARRAY['s2_l2a','s1_grd','gibs_true_colour','landsat_c2l2']::text[]),
  CONSTRAINT ia_priority CHECK (priority BETWEEN 0 AND 3),
  -- a retired AOI is looked at by nothing
  CONSTRAINT ia_retired_consistent CHECK (
    (retired_at IS NULL) = (retired_reason IS NULL)
    AND (retired_at IS NULL OR sensors_enabled = '{}')),
  CONSTRAINT ia_geom_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom))
);

CREATE UNIQUE INDEX IF NOT EXISTS imagery_aois_source_uq
  ON public.imagery_aois (kind, source_table, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS imagery_aois_geom_gist
  ON public.imagery_aois USING gist (geom);
CREATE INDEX IF NOT EXISTS imagery_aois_active_kind_idx
  ON public.imagery_aois (kind) WHERE retired_at IS NULL;

COMMENT ON TABLE public.imagery_aois IS
  'IMG-1 (mig 183). One row per SITE eYKON may image (count sites, never rows). Seeded and kept in step by imagery_aois_sync() from refinery_complexes, lng_terminals (by project), ports (harbor_size L/M) and mines_curated. sensors_enabled starts empty: nothing is imaged until IMG-2 enables a sensor. The footprint is frozen once an observation exists.';

-- ─── 3 · Observations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.imagery_observations (
  id                    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aoi_id                text        NOT NULL REFERENCES public.imagery_aois (aoi_id),
  sensor                text        NOT NULL,
  provider_id           text        NOT NULL REFERENCES public.imagery_licences (provider_id),
  acquired_at           timestamptz NOT NULL,
  coverage_state        text        NOT NULL,
  cloud_fraction_aoi    numeric,
  aoi_covered_fraction  numeric,
  metric_name           text,
  metric_stat           text,
  metric_value          double precision,
  baseline_median       double precision,
  baseline_n            integer,
  baseline_window       text,
  chip_path             text,
  pu_cost               numeric,
  request_id            text,
  ingested_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT io_sensor CHECK (sensor IN ('s2_l2a','s1_grd','gibs_true_colour','landsat_c2l2')),
  CONSTRAINT io_coverage_state CHECK (coverage_state IN
    ('clear','partly_cloudy','cloudy','partial_swath','no_acquisition','processing_error')),
  -- VOID: a value exists only on a clear look
  CONSTRAINT io_value_only_when_clear CHECK (metric_value IS NULL OR coverage_state = 'clear'),
  CONSTRAINT io_metric_pair CHECK ((metric_name IS NULL) = (metric_stat IS NULL)
                                   AND (metric_value IS NULL OR metric_name IS NOT NULL)),
  -- never a mean (brief §16.13)
  CONSTRAINT io_metric_stat CHECK (metric_stat IS NULL OR metric_stat IN ('median','count','area_m2','fraction')),
  CONSTRAINT io_metric_finite CHECK (metric_value IS NULL OR metric_value NOT IN ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)),
  CONSTRAINT io_fractions_range CHECK (
    (cloud_fraction_aoi IS NULL OR cloud_fraction_aoi BETWEEN 0 AND 1)
    AND (aoi_covered_fraction IS NULL OR aoi_covered_fraction BETWEEN 0 AND 1)),
  -- radar has no clouds; a clear optical look must say how cloudy the AOI was
  CONSTRAINT io_sar_no_cloud CHECK (sensor <> 's1_grd' OR cloud_fraction_aoi IS NULL),
  CONSTRAINT io_clear_optical_has_cloud CHECK
    (coverage_state <> 'clear' OR sensor = 's1_grd' OR cloud_fraction_aoi IS NOT NULL),
  -- 'clear' means the acquisition covered the AOI
  CONSTRAINT io_clear_is_covered CHECK
    (coverage_state <> 'clear' OR aoi_covered_fraction >= 0.99),
  -- a look that did not happen has no picture
  CONSTRAINT io_void_no_chip CHECK
    (coverage_state NOT IN ('no_acquisition','processing_error') OR chip_path IS NULL),
  -- a baseline travels with its n, or not at all
  CONSTRAINT io_baseline_pair CHECK (
    (baseline_median IS NULL) = (baseline_n IS NULL)
    AND (baseline_n IS NULL OR (baseline_n >= 1 AND baseline_window IS NOT NULL))),
  CONSTRAINT io_pu_cost CHECK (pu_cost IS NULL OR pu_cost >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS imagery_observations_natural_uq
  ON public.imagery_observations (aoi_id, sensor, acquired_at, coalesce(metric_name, ''));
CREATE INDEX IF NOT EXISTS imagery_observations_aoi_sensor_time_idx
  ON public.imagery_observations (aoi_id, sensor, acquired_at DESC);
CREATE INDEX IF NOT EXISTS imagery_observations_ingested_idx
  ON public.imagery_observations (ingested_at DESC);

COMMENT ON TABLE public.imagery_observations IS
  'IMG-1 (mig 183). One row per AOI × sensor × acquisition eYKON looked at. coverage_state is stored, never derived at read time; metric_value exists only on a clear look (every other state is VOID for claims, alerts and convergence). Statistics are medians, counts, areas or fractions — never means. Absence of a row means eYKON did not look.';

-- ─── 4 · Webcams ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webcams (
  webcam_id         text        PRIMARY KEY,
  provider_id       text        NOT NULL REFERENCES public.imagery_licences (provider_id),
  provider_cam_id   text        NOT NULL,
  upstream_url      text        NOT NULL,
  name              text        NOT NULL,
  latitude          double precision NOT NULL,
  longitude         double precision NOT NULL,
  -- derived, so the point and the lat/lon can never disagree
  geom              geography(Point, 4326)
                    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED,
  heading_deg       smallint,
  category          text        NOT NULL,
  media_type        text        NOT NULL,
  attribution_text  text        NOT NULL,
  nearest_aoi_id    text        REFERENCES public.imagery_aois (aoi_id),
  is_live           boolean     NOT NULL DEFAULT false,
  last_ok_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  retired_at        timestamptz,
  CONSTRAINT wc_id_format CHECK (webcam_id ~ '^wc_[0-9a-f]{16}$'),
  CONSTRAINT wc_latlon_range CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180),
  CONSTRAINT wc_heading CHECK (heading_deg IS NULL OR heading_deg BETWEEN 0 AND 359),
  CONSTRAINT wc_category CHECK (category IN
    ('traffic','port','bridge','border','city','coast','mountain','volcano','weather','other')),
  CONSTRAINT wc_media_type CHECK (media_type IN ('image','hls','youtube')),
  CONSTRAINT wc_attribution CHECK (length(attribution_text) > 0),
  CONSTRAINT wc_upstream_http CHECK (upstream_url ~ '^https?://'),
  CONSTRAINT wc_retired_not_live CHECK (retired_at IS NULL OR is_live = false),
  CONSTRAINT wc_provider_cam_uq UNIQUE (provider_id, provider_cam_id)
);

CREATE INDEX IF NOT EXISTS webcams_geom_gist ON public.webcams USING gist (geom);
CREATE INDEX IF NOT EXISTS webcams_live_idx ON public.webcams (provider_id) WHERE is_live;

COMMENT ON TABLE public.webcams IS
  'IMG-1 (mig 183). Camera registry. webcam_id is opaque (wc_ + 16 hex); upstream_url is service-role only and never sent to a client. is_live requires the provider''s licence to read ''ok'' (trigger). No frame history is stored here.';
COMMENT ON COLUMN public.webcams.upstream_url IS
  'Service-role only. Never returned by a public route, never encoded into a client-visible path.';

CREATE TABLE IF NOT EXISTS public.webcam_liveness (
  webcam_id     text        NOT NULL REFERENCES public.webcams (webcam_id),
  checked_at    timestamptz NOT NULL,
  outcome       text        NOT NULL,
  http_status   smallint,
  bytes_len     integer,
  bytes_sha256  text,
  PRIMARY KEY (webcam_id, checked_at),
  CONSTRAINT wl_outcome CHECK (outcome IN ('ok','http_error','frozen','timeout','decode_error')),
  CONSTRAINT wl_sha CHECK (bytes_sha256 IS NULL OR bytes_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT wl_ok_has_bytes CHECK (outcome <> 'ok' OR (bytes_len > 0 AND bytes_sha256 IS NOT NULL))
);

COMMENT ON TABLE public.webcam_liveness IS
  'IMG-1 (mig 183). One row per fetch attempt: hash and size of what came back, never the bytes. A camera returning the same hash N times is frozen — a frozen frame is looks-alive-but-isn''t.';

-- ─── 5 · Licence gate (triggers — a CHECK cannot read another table) ────
CREATE OR REPLACE FUNCTION public.imagery_licence_status(p_provider text)
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT commercial_status FROM public.imagery_licences WHERE provider_id = p_provider
$function$;

CREATE OR REPLACE FUNCTION public.imagery_enforce_licence()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_status text := public.imagery_licence_status(NEW.provider_id);
BEGIN
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'imagery licence gate: provider % has no licence row', NEW.provider_id;
  END IF;
  IF TG_TABLE_NAME = 'imagery_observations' AND v_status IN ('forbidden','excluded') THEN
    RAISE EXCEPTION 'imagery licence gate: provider % is %, no observation may be stored', NEW.provider_id, v_status;
  END IF;
  IF TG_TABLE_NAME = 'webcams' THEN
    IF v_status = 'excluded' THEN
      RAISE EXCEPTION 'imagery licence gate: provider % is excluded, its cameras may not be registered', NEW.provider_id;
    END IF;
    IF NEW.is_live AND v_status <> 'ok' THEN
      RAISE EXCEPTION 'imagery licence gate: provider % is %, a camera can be live only under an ok licence', NEW.provider_id, v_status;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS imagery_observations_licence_gate ON public.imagery_observations;
CREATE TRIGGER imagery_observations_licence_gate
  BEFORE INSERT OR UPDATE ON public.imagery_observations
  FOR EACH ROW EXECUTE FUNCTION public.imagery_enforce_licence();

DROP TRIGGER IF EXISTS webcams_licence_gate ON public.webcams;
CREATE TRIGGER webcams_licence_gate
  BEFORE INSERT OR UPDATE ON public.webcams
  FOR EACH ROW EXECUTE FUNCTION public.imagery_enforce_licence();

-- A licence downgraded below 'ok' takes its live cameras down with it.
CREATE OR REPLACE FUNCTION public.imagery_licence_downgrade()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.commercial_status IS DISTINCT FROM OLD.commercial_status AND NEW.commercial_status <> 'ok' THEN
    UPDATE public.webcams SET is_live = false, updated_at = now()
     WHERE provider_id = NEW.provider_id AND is_live;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS imagery_licences_downgrade ON public.imagery_licences;
CREATE TRIGGER imagery_licences_downgrade
  BEFORE UPDATE ON public.imagery_licences
  FOR EACH ROW EXECUTE FUNCTION public.imagery_licence_downgrade();

-- ─── 6 · Frozen footprints ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.imagery_aois_freeze_geom()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'imagery_aois: rows are retired, never deleted (aoi %)', OLD.aoi_id;
  END IF;
  IF NOT ST_Equals(NEW.geom, OLD.geom)
     AND EXISTS (SELECT 1 FROM public.imagery_observations o WHERE o.aoi_id = OLD.aoi_id) THEN
    RAISE EXCEPTION 'imagery_aois: footprint of % is frozen — it has observations; retire it and mint a new AOI instead', OLD.aoi_id;
  END IF;
  IF NEW.aoi_id <> OLD.aoi_id OR NEW.kind <> OLD.kind
     OR NEW.source_table IS DISTINCT FROM OLD.source_table
     OR NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    RAISE EXCEPTION 'imagery_aois: identity of % is frozen', OLD.aoi_id;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS imagery_aois_frozen ON public.imagery_aois;
CREATE TRIGGER imagery_aois_frozen
  BEFORE UPDATE OR DELETE ON public.imagery_aois
  FOR EACH ROW EXECUTE FUNCTION public.imagery_aois_freeze_geom();

-- ─── 7 · The one writer of AOIs ────────────────────────────────────────
-- Returns one row per kind: inserted, refreshed (footprint changed, no
-- observations yet), retired (source gone), active after the run.
CREATE OR REPLACE FUNCTION public.imagery_aois_sync()
RETURNS TABLE (kind text, inserted integer, refreshed integer, retired integer, active integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  k text;
  n_ins integer; n_ref integer; n_ret integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _imagery_aoi_src (
    aoi_id text PRIMARY KEY, kind text, source_table text, source_id text,
    name text, country_iso text, geom geometry(Polygon, 4326), buffer_rule text
  ) ON COMMIT DROP;
  TRUNCATE _imagery_aoi_src;

  -- refinery complexes: hull of CURRENT members, +1,000 m on the geography
  INSERT INTO _imagery_aoi_src
  SELECT 'refinery_complex:' || c.cluster_key, 'refinery_complex', 'refinery_complexes', c.cluster_key,
         (SELECT string_agg(DISTINCT r2.refinery_name, ' / ' ORDER BY r2.refinery_name)
            FROM public.refinery_complex_members m2
            JOIN public.refineries r2 ON r2.id = m2.facility_id
           WHERE m2.cluster_key = c.cluster_key AND m2.left_at IS NULL AND r2.refinery_name IS NOT NULL),
         (SELECT upper(r3.iso_country)
            FROM public.refinery_complex_members m3
            JOIN public.refineries r3 ON r3.id = m3.facility_id
           WHERE m3.cluster_key = c.cluster_key AND m3.left_at IS NULL AND r3.iso_country ~* '^[a-z]{2}$'
           GROUP BY upper(r3.iso_country) ORDER BY count(*) DESC, upper(r3.iso_country) LIMIT 1),
         ST_Buffer(ST_ConvexHull(ST_Collect(ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)))::geography, 1000)::geometry,
         'convex_hull(current members) + 1000 m'
    FROM public.refinery_complexes c
    JOIN public.refinery_complex_members m ON m.cluster_key = c.cluster_key AND m.left_at IS NULL
    JOIN public.refineries r ON r.id = m.facility_id
   WHERE c.retired_at IS NULL
   GROUP BY c.cluster_key;

  -- LNG terminals: one site per project (units are rows), operating only
  INSERT INTO _imagery_aoi_src
  SELECT 'lng_terminal:' || s.site_key, 'lng_terminal', 'lng_terminals', s.site_key, s.name, NULL,
         ST_Buffer(ST_Centroid(s.pts)::geography, 1500)::geometry, 'centroid(operating units) + 1500 m'
    FROM (SELECT coalesce(t.project_id, t.id) AS site_key,
                 min(t.terminal_name) AS name,
                 ST_Collect(ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)) AS pts
            FROM public.lng_terminals t
           WHERE t.status = 'operating'
           GROUP BY coalesce(t.project_id, t.id)) s;

  -- ports: large and medium harbours (World Port Index)
  INSERT INTO _imagery_aoi_src
  SELECT 'port:' || p.id, 'port', 'ports', p.id, p.port_name,
         CASE WHEN p.country_code ~ '^[A-Z]{2}$' THEN p.country_code END,
         ST_Buffer(ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography, 2000)::geometry,
         'point + 2000 m'
    FROM public.ports p
   WHERE p.harbor_size IN ('L', 'M');

  -- curated mines with a published coordinate (mig 080). ONE SITE, NOT ONE
  -- ROW: heavy-REE mines are listed once per workspace (dysprosium AND
  -- terbium) but are the same physical pit, so rows are grouped by their
  -- coordinate (3 decimals ≈ 100 m, the precision 080 seeded) and the site
  -- is keyed by the lowest row id in the group.
  INSERT INTO _imagery_aoi_src
  SELECT 'mine:' || g.site_key, 'mine', 'mines_curated', g.site_key, g.name, g.country_iso,
         ST_Buffer(ST_SetSRID(ST_MakePoint(g.lon, g.lat), 4326)::geography, 2000)::geometry,
         'point + 2000 m (rows at one coordinate = one site)'
    FROM (SELECT min(mc.id::text) AS site_key,
                 min(mc.name) AS name,
                 min(CASE WHEN upper(mc.country) ~ '^[A-Z]{2}$' THEN upper(mc.country) END) AS country_iso,
                 round(mc.latitude::numeric, 3)::double precision  AS lat,
                 round(mc.longitude::numeric, 3)::double precision AS lon
            FROM public.mines_curated mc
           WHERE mc.latitude IS NOT NULL AND mc.longitude IS NOT NULL
           GROUP BY round(mc.latitude::numeric, 3), round(mc.longitude::numeric, 3)) g;

  FOR k IN SELECT unnest(ARRAY['refinery_complex','lng_terminal','port','mine']) LOOP
    INSERT INTO public.imagery_aois AS a
      (aoi_id, kind, source_table, source_id, name, country_iso, geom, centroid_lat, centroid_lon, area_km2, buffer_rule)
    SELECT s.aoi_id, s.kind, s.source_table, s.source_id, s.name, s.country_iso, s.geom,
           ST_Y(ST_Centroid(s.geom)), ST_X(ST_Centroid(s.geom)),
           ST_Area(s.geom::geography) / 1e6, s.buffer_rule
      FROM _imagery_aoi_src s
     WHERE s.kind = k
    ON CONFLICT (aoi_id) DO NOTHING;
    GET DIAGNOSTICS n_ins = ROW_COUNT;

    -- refresh a footprint only while nothing has been observed over it
    UPDATE public.imagery_aois a
       SET geom = s.geom, name = s.name, country_iso = s.country_iso,
           centroid_lat = ST_Y(ST_Centroid(s.geom)), centroid_lon = ST_X(ST_Centroid(s.geom)),
           area_km2 = ST_Area(s.geom::geography) / 1e6, buffer_rule = s.buffer_rule, updated_at = now()
      FROM _imagery_aoi_src s
     WHERE s.aoi_id = a.aoi_id AND a.kind = k AND a.retired_at IS NULL
       AND NOT ST_Equals(a.geom, s.geom)
       AND NOT EXISTS (SELECT 1 FROM public.imagery_observations o WHERE o.aoi_id = a.aoi_id);
    GET DIAGNOSTICS n_ref = ROW_COUNT;

    UPDATE public.imagery_aois a
       SET retired_at = now(), retired_reason = 'source_gone', sensors_enabled = '{}', updated_at = now()
     WHERE a.kind = k AND a.retired_at IS NULL AND a.source_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM _imagery_aoi_src s WHERE s.aoi_id = a.aoi_id);
    GET DIAGNOSTICS n_ret = ROW_COUNT;

    kind := k; inserted := n_ins; refreshed := n_ref; retired := n_ret;
    SELECT count(*) INTO active FROM public.imagery_aois a WHERE a.kind = k AND a.retired_at IS NULL;
    RETURN NEXT;
  END LOOP;
END
$function$;

COMMENT ON FUNCTION public.imagery_aois_sync() IS
  'IMG-1 (mig 183). The one writer of imagery_aois. Inserts new sites from the registries, refreshes a footprint only while it has no observations, retires AOIs whose source is gone. Idempotent: a second run inserts, refreshes and retires nothing.';

-- ─── 8 · Access: service_role only ─────────────────────────────────────
ALTER TABLE public.imagery_licences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imagery_aois         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imagery_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webcams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webcam_liveness      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.imagery_licences, public.imagery_aois, public.imagery_observations,
              public.webcams, public.webcam_liveness
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.imagery_licences, public.imagery_aois,
                                public.imagery_observations, public.webcams
  TO service_role;
GRANT SELECT, INSERT, DELETE ON public.webcam_liveness TO service_role;

REVOKE EXECUTE ON FUNCTION public.imagery_licence_status(text)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_enforce_licence()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_licence_downgrade()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_aois_freeze_geom()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.imagery_aois_sync()            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.imagery_licence_status(text)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.imagery_aois_sync()            TO service_role;

-- ─── 9 · Seed ──────────────────────────────────────────────────────────
SELECT * FROM public.imagery_aois_sync();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY — read-only. Paste these rows back.
-- ═══════════════════════════════════════════════════════════════════════
-- V1 · AOIs per kind against their source registries (sites, not rows)
SELECT 'refinery_complex' AS kind,
       (SELECT count(*) FROM public.imagery_aois WHERE kind = 'refinery_complex' AND retired_at IS NULL) AS aois,
       (SELECT count(*) FROM public.refinery_complexes c WHERE c.retired_at IS NULL
          AND EXISTS (SELECT 1 FROM public.refinery_complex_members m WHERE m.cluster_key = c.cluster_key AND m.left_at IS NULL)) AS source_sites
UNION ALL
SELECT 'lng_terminal',
       (SELECT count(*) FROM public.imagery_aois WHERE kind = 'lng_terminal' AND retired_at IS NULL),
       (SELECT count(DISTINCT coalesce(project_id, id)) FROM public.lng_terminals WHERE status = 'operating')
UNION ALL
SELECT 'port',
       (SELECT count(*) FROM public.imagery_aois WHERE kind = 'port' AND retired_at IS NULL),
       (SELECT count(*) FROM public.ports WHERE harbor_size IN ('L','M'))
UNION ALL
SELECT 'mine',
       (SELECT count(*) FROM public.imagery_aois WHERE kind = 'mine' AND retired_at IS NULL),
       (SELECT count(DISTINCT (round(latitude::numeric, 3), round(longitude::numeric, 3)))
          FROM public.mines_curated WHERE latitude IS NOT NULL AND longitude IS NOT NULL);

-- V2 · nothing is imaged yet, and footprints are plausible
SELECT count(*) FILTER (WHERE sensors_enabled <> '{}') AS aois_with_a_sensor_enabled,   -- expect 0
       round(min(area_km2)::numeric, 2) AS min_km2,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY area_km2)::numeric, 2) AS median_km2,
       round(max(area_km2)::numeric, 2) AS max_km2,
       count(*) FILTER (WHERE country_iso IS NULL) AS aois_without_country
  FROM public.imagery_aois WHERE retired_at IS NULL;

-- V3 · licences by status
SELECT commercial_status, count(*) AS providers, string_agg(provider_id, ', ' ORDER BY provider_id) AS provider_ids
  FROM public.imagery_licences GROUP BY commercial_status ORDER BY commercial_status;

-- V4 · a second sync is a no-op (idempotence) — expect every inserted/refreshed/retired = 0
SELECT * FROM public.imagery_aois_sync();
