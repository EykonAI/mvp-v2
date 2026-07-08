import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Sentinel-2 stockpile imagery ingest · monthly (P2c, INTEL P2 §3.2).
 *
 * Grounds the Critical Minerals "05 Sentinel-2 Stockpile Imagery"
 * panel. For every mines_curated row with verified coordinates
 * (migration 080, cap AOI_CAP per tick) it pulls, via the Copernicus
 * Data Space Ecosystem (CDSE) Sentinel Hub APIs:
 *
 *  1. Statistical API — daily-aggregated NDVI mean over a ~2 km bbox
 *     for the last 45 days (cloud-filtered S2 L2A). The most recent
 *     interval with valid stats gives BOTH the acquisition date and
 *     the index mean. NDVI is the v1 bare-soil proxy: LOWER
 *     vegetation ≈ MORE disturbed / stockpile ground, so a falling
 *     mean suggests expanding workings.
 *  2. Process API — a 512×512 true-colour PNG chip for that same
 *     acquisition date, uploaded to the public 'sentinel' storage
 *     bucket (path mines/<slug>/<acq-date>.png).
 *
 * Rows land in sentinel_tiles keyed (aoi_ref, acquisition_date);
 * change_pct compares against the previous stored tile's index_mean
 * for the same aoi_ref.
 *
 * Auth: OAuth2 client-credentials against CDSE identity. Requires
 * CDSE_CLIENT_ID + CDSE_CLIENT_SECRET (dataspace.copernicus.eu →
 * User Settings → OAuth clients). Unset → { skipped } gracefully.
 *
 * Cost: ~1 PU per 512 px chip + ~1 PU per statistical call, so a
 * full 20-AOI tick is ~40 PU. CDSE free tier is 10,000+ PU/month —
 * monthly cadence uses well under 1% of it.
 *
 * Endpoints (verified against documentation.dataspace.copernicus.eu,
 * 2026-07):
 *   token   https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token
 *   process https://sh.dataspace.copernicus.eu/api/v1/process
 *   stats   https://sh.dataspace.copernicus.eu/api/v1/statistics
 */

const TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

const AOI_CAP = 20; // AOIs per tick
const LOOKBACK_DAYS = 45; // S2 revisit is ~5 days; 45 d survives a cloudy month
const MAX_CLOUD_PCT = 30;
const BBOX_HALF_KM = 1; // ~2 km square chip
const CHIP_PX = 512;
const INDEX_NAME = 'ndvi_mean_v1';
const BUCKET = 'sentinel';

// ── Evalscripts ──────────────────────────────────────────────────

// Statistical: NDVI + dataMask (mandatory), clouds masked via SCL.
const NDVI_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ['B04', 'B08', 'SCL', 'dataMask'] }],
    output: [
      { id: 'ndvi', bands: 1 },
      { id: 'dataMask', bands: 1 },
    ],
  };
}
function evaluatePixel(s) {
  const ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-6);
  const cloudy = s.SCL === 8 || s.SCL === 9 || s.SCL === 10; // cloud med/high, cirrus
  return { ndvi: [ndvi], dataMask: [cloudy ? 0 : s.dataMask] };
}`;

// Process: simple gain-stretched true colour.
const TRUECOLOR_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: ['B02', 'B03', 'B04'], output: { bands: 3 } };
}
function evaluatePixel(s) {
  return [2.5 * s.B04, 2.5 * s.B03, 2.5 * s.B02];
}`;

// ── Helpers ──────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** ~2 km bbox around a point, [minLon, minLat, maxLon, maxLat] (EPSG:4326). */
function bboxAround(lat: number, lon: number): [number, number, number, number] {
  const dLat = BBOX_HALF_KM / 111.32;
  const dLon = BBOX_HALF_KM / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

async function fetchToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`CDSE token: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('CDSE token: no access_token in response');
  return json.access_token;
}

interface StatsInterval {
  interval: { from: string; to: string };
  outputs?: {
    ndvi?: { bands?: { B0?: { stats?: { mean?: number; sampleCount?: number; noDataCount?: number } } } };
  };
}

/** Latest cloud-filtered acquisition in the window: date + NDVI mean. */
async function latestNdvi(
  token: string,
  bbox: [number, number, number, number],
  from: string,
  to: string,
): Promise<{ date: string; mean: number } | null> {
  const body = {
    input: {
      bounds: {
        bbox,
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: { maxCloudCoverage: MAX_CLOUD_PCT },
        },
      ],
    },
    aggregation: {
      timeRange: { from, to },
      aggregationInterval: { of: 'P1D' },
      evalscript: NDVI_EVALSCRIPT,
      width: 128,
      height: 128,
    },
    calculations: { default: {} },
  };
  const res = await fetch(STATS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`statistics: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data?: StatsInterval[] };
  const intervals = json.data ?? [];
  // Scan newest-first for an interval with a real mean.
  for (let i = intervals.length - 1; i >= 0; i--) {
    const stats = intervals[i]?.outputs?.ndvi?.bands?.B0?.stats;
    const mean = stats?.mean;
    if (typeof mean === 'number' && Number.isFinite(mean) && (stats?.sampleCount ?? 0) > 0) {
      return { date: intervals[i].interval.from.slice(0, 10), mean };
    }
  }
  return null;
}

/** True-colour PNG chip for one acquisition date. */
async function fetchChip(
  token: string,
  bbox: [number, number, number, number],
  date: string,
): Promise<ArrayBuffer> {
  const body = {
    input: {
      bounds: {
        bbox,
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
            maxCloudCoverage: MAX_CLOUD_PCT,
            mosaickingOrder: 'leastCC',
          },
        },
      ],
    },
    output: {
      width: CHIP_PX,
      height: CHIP_PX,
      responses: [{ identifier: 'default', format: { type: 'image/png' } }],
    },
    evalscript: TRUECOLOR_EVALSCRIPT,
  };
  const res = await fetch(PROCESS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'image/png',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`process: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.arrayBuffer();
}

// ── Handler ──────────────────────────────────────────────────────

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const clientId = process.env.CDSE_CLIENT_ID;
  const clientSecret = process.env.CDSE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'CDSE_CLIENT_ID / CDSE_CLIENT_SECRET not set',
    });
  }

  const startedAt = Date.now();
  const supabase = createServerSupabase();
  const errors: string[] = [];
  let tilesWritten = 0;
  let skipped = 0;

  // AOIs: curated mines with verified coordinates (migration 080).
  const { data: mines, error: minesErr } = await supabase
    .from('mines_curated')
    .select('mineral, name, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('name');
  if (minesErr) {
    return NextResponse.json(
      { ok: false, error: `mines_curated: ${minesErr.message}` },
      { status: 502 },
    );
  }

  // Dedupe by slug — heavy-REE rows are duplicated across the
  // dysprosium/terbium workspaces but are the same physical site.
  const seen = new Set<string>();
  const aois: Array<{ slug: string; mineral: string; lat: number; lon: number }> = [];
  for (const m of mines ?? []) {
    const slug = slugify(m.name as string);
    if (seen.has(slug)) continue;
    seen.add(slug);
    aois.push({
      slug,
      mineral: m.mineral as string,
      lat: m.latitude as number,
      lon: m.longitude as number,
    });
    if (aois.length >= AOI_CAP) break;
  }

  let token: string;
  try {
    token = await fetchToken(clientId, clientSecret);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const to = new Date();
  const from = new Date(to.getTime() - LOOKBACK_DAYS * 24 * 3600 * 1000);
  const fromIso = `${from.toISOString().slice(0, 10)}T00:00:00Z`;
  const toIso = `${to.toISOString().slice(0, 10)}T23:59:59Z`;

  for (const aoi of aois) {
    try {
      const bbox = bboxAround(aoi.lat, aoi.lon);

      // 1. Latest cloud-filtered acquisition + NDVI mean.
      const stat = await latestNdvi(token, bbox, fromIso, toIso);
      if (!stat) {
        skipped++;
        errors.push(`${aoi.slug}: no cloud-free S2 acquisition in the last ${LOOKBACK_DAYS} d`);
        continue;
      }

      // Already stored? Skip the imagery spend.
      const { data: existing } = await supabase
        .from('sentinel_tiles')
        .select('id')
        .eq('aoi_ref', aoi.slug)
        .eq('acquisition_date', stat.date)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }

      // 2. True-colour chip → storage.
      const png = await fetchChip(token, bbox, stat.date);
      const storagePath = `mines/${aoi.slug}/${stat.date}.png`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, png, { contentType: 'image/png', upsert: true });
      if (upErr) throw new Error(`storage upload: ${upErr.message}`);
      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

      // 3. Change vs the previous stored tile for this AOI.
      const { data: prev } = await supabase
        .from('sentinel_tiles')
        .select('index_mean')
        .eq('aoi_ref', aoi.slug)
        .lt('acquisition_date', stat.date)
        .order('acquisition_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      const prevMean =
        prev && prev.index_mean !== null ? Number(prev.index_mean) : null;
      const changePct =
        prevMean !== null && Math.abs(prevMean) > 1e-9
          ? ((stat.mean - prevMean) / Math.abs(prevMean)) * 100
          : null;

      const { error: tileErr } = await supabase.from('sentinel_tiles').upsert(
        {
          aoi_kind: 'mine',
          aoi_ref: aoi.slug,
          mineral: aoi.mineral,
          latitude: aoi.lat,
          longitude: aoi.lon,
          acquisition_date: stat.date,
          image_url: publicUrl,
          storage_path: storagePath,
          index_name: INDEX_NAME,
          index_mean: stat.mean,
          prev_mean: prevMean,
          change_pct: changePct,
          captured_at: new Date().toISOString(),
        },
        { onConflict: 'aoi_ref,acquisition_date' },
      );
      if (tileErr) throw new Error(`sentinel_tiles upsert: ${tileErr.message}`);
      tilesWritten++;
    } catch (err) {
      errors.push(`${aoi.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const ok = tilesWritten > 0 || errors.length === 0;
  return NextResponse.json(
    {
      ok,
      aois: aois.length,
      tiles_written: tilesWritten,
      skipped,
      errors,
      elapsed_ms: Date.now() - startedAt,
    },
    { status: ok ? 200 : 502 },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
