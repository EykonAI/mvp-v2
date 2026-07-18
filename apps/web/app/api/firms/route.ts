import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// NASA FIRMS thermal anomalies (active-fire hot-pixel detections).
//
// HONESTY INVARIANT — read before touching any label downstream:
// A row here is a THERMAL ANOMALY DETECTION, not a fire and not a strike.
// FIRMS reports pixels whose measured radiance exceeds a background model.
// A large share of persistent detections are routine industrial gas flares,
// agricultural burning, or hot industrial surfaces. Attribution of a
// detection to any event, facility or actor is INFERENCE, never observation.
// Conversely, absence of a detection is not absence of fire: cloud cover,
// smoke, and satellite overpass gaps all suppress detections.
// Any user-facing string derived from this route must say "thermal anomaly"
// / "detected", never "fire at X" or "strike".
//
// Reads firms_thermal_anomalies (migrations 081–083), populated by the FIRMS
// ingestion cron. Mirrors the /api/conflicts + /api/aircraft Supabase pattern:
// bbox-scoped, recency-windowed, hard row cap, honest degradation (an empty
// table yields an empty layer rather than an error).

const PROVIDER = (process.env.FIRMS_PROVIDER || 'supabase').toLowerCase();

// Default recency window. FIRMS NRT lands ~3h after overpass, so 48h is the
// smallest window that reliably contains full global coverage.
const DEFAULT_WINDOW_HOURS = 48;
const MAX_WINDOW_HOURS = 24 * 14;

const DEFAULT_LIMIT = 3000;
const MAX_LIMIT = 10000;

// Retention boundary — must track FIRMS_RAW_RETENTION_DAYS in
// apps/web/app/api/cron/ingest-firms/route.ts (migration 086).
//
// Detections are retained in two tiers: ALL detections for this many
// days (which is what this layer draws), and only those within the
// ingest proximity radius of a monitored facility for far longer.
// So a request for a window LONGER than this does not return a
// thinner version of the same picture — it returns a structurally
// different one, ~91% of the points having been pruned as
// non-facility-proximate. Callers are told, via `raw_complete` and
// `partial_window`, rather than being left to infer that the world
// stopped burning three days ago.
const RAW_RETENTION_DAYS = Number(process.env.FIRMS_RAW_RETENTION_DAYS ?? 3);

/**
 * FIRMS ships two incompatible confidence encodings in the same feed:
 *   VIIRS (SNPP / NOAA-20) → 'l' | 'n' | 'h'
 *   MODIS                  → numeric string, 0–100
 * Normalise to one band so the globe can filter uniformly. MODIS thresholds
 * follow NASA's own guidance (<30 low, 30–80 nominal, >80 high).
 */
function confidenceBand(raw: string | null | undefined): 'low' | 'nominal' | 'high' {
  if (!raw) return 'nominal';
  const s = String(raw).trim().toLowerCase();
  if (s === 'l') return 'low';
  if (s === 'n') return 'nominal';
  if (s === 'h') return 'high';
  const n = Number(s);
  if (!Number.isFinite(n)) return 'nominal';
  if (n < 30) return 'low';
  if (n > 80) return 'high';
  return 'nominal';
}

/**
 * acq_time is stored as a 4-char 'HHMM' UTC string. Combine with acq_date
 * into an ISO timestamp for the client. Returns null rather than guessing
 * when the field is malformed.
 */
function acquiredAtISO(acq_date: string | null, acq_time: string | null): string | null {
  if (!acq_date) return null;
  const t = (acq_time || '').padStart(4, '0');
  if (!/^\d{4}$/.test(t)) return `${acq_date}T00:00:00Z`;
  return `${acq_date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`;
}

async function fetchFromSupabase(params: URLSearchParams) {
  const supabase = createServerSupabase();

  const hours = Math.min(
    Math.max(parseInt(params.get('hours') || String(DEFAULT_WINDOW_HOURS)) || DEFAULT_WINDOW_HOURS, 1),
    MAX_WINDOW_HOURS,
  );
  const limit = Math.min(parseInt(params.get('limit') || String(DEFAULT_LIMIT)) || DEFAULT_LIMIT, MAX_LIMIT);

  // acq_date is a DATE, so the window floors to whole days — a 24h request
  // returns "today and yesterday" rather than a rolling 24h. Documented in
  // the response as `window_hours` + `since` so the client can't over-claim.
  const days = Math.ceil(hours / 24);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];

  let query = supabase
    .from('firms_thermal_anomalies')
    .select('id,satellite,acq_date,acq_time,latitude,longitude,brightness,bright_ti5,frp,confidence,daynight')
    .gte('acq_date', since)
    // Highest radiative power first: when the cap bites, we keep the most
    // energetic detections rather than an arbitrary slice.
    .order('frp', { ascending: false, nullsFirst: false })
    .limit(limit);

  const minFrp = params.get('min_frp');
  if (minFrp && Number.isFinite(parseFloat(minFrp))) {
    query = query.gte('frp', parseFloat(minFrp));
  }

  // Opt-in: only detections near a monitored facility (migration 086).
  // This is the analytically interesting subset — it is NOT a claim
  // that these detections are caused by, or attributable to, those
  // facilities. Proximity is geometry.
  const proximateOnly = /^(1|true|yes)$/i.test(params.get('proximate') || '');
  if (proximateOnly) {
    query = query.eq('facility_proximate', true);
  }

  // Bounding box — accept both the snake_case spelling used by /api/conflicts
  // and /api/aircraft and the /api/vessels camel-mashed form.
  const latMin = params.get('lat_min') ?? params.get('latmin');
  if (latMin) {
    const latMax = params.get('lat_max') ?? params.get('latmax') ?? '90';
    const lonMin = params.get('lon_min') ?? params.get('lonmin') ?? '-180';
    const lonMax = params.get('lon_max') ?? params.get('lonmax') ?? '180';
    query = query
      .gte('latitude', parseFloat(latMin))
      .lte('latitude', parseFloat(latMax))
      .gte('longitude', parseFloat(lonMin))
      .lte('longitude', parseFloat(lonMax));
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
  }

  const rows = data ?? [];

  // Optional post-filter: confidence bands are derived, not stored, so this
  // cannot be pushed into the query.
  const bandParam = (params.get('confidence') || '').trim().toLowerCase();
  const mapped = rows
    .map((r: any) => ({
      id: r.id,
      satellite: r.satellite || '',
      latitude: r.latitude,
      longitude: r.longitude,
      // frp = fire radiative power in megawatts: the measured radiant output
      // of the hot pixel. Drives point size/colour on the globe.
      frp: r.frp != null ? Number(r.frp) : null,
      brightness: r.brightness != null ? Number(r.brightness) : null,
      bright_ti5: r.bright_ti5 != null ? Number(r.bright_ti5) : null,
      confidence: r.confidence || '',
      confidence_band: confidenceBand(r.confidence),
      daynight: r.daynight || '',
      acq_date: r.acq_date,
      acq_time: r.acq_time || '',
      acquired_at: acquiredAtISO(r.acq_date, r.acq_time),
    }))
    .filter((r) => (bandParam ? r.confidence_band === bandParam : true));

  return NextResponse.json({
    count: mapped.length,
    timestamp: new Date().toISOString(),
    provider: 'supabase',
    source: 'NASA FIRMS (VIIRS SNPP/NOAA-20 + MODIS, near-real-time)',
    window_hours: hours,
    since,
    proximate_only: proximateOnly,
    // Days back from today for which ALL detections are retained.
    raw_complete_days: RAW_RETENTION_DAYS,
    // True when the requested window reaches past the raw retention
    // boundary, so the older part of it holds only facility-proximate
    // detections. Render a caveat, or clamp — do not read the thinning
    // as a real decline in thermal activity.
    partial_window: !proximateOnly && days > RAW_RETENTION_DAYS,
    // True when the cap bit — the client is seeing the highest-FRP subset,
    // not everything in the viewport.
    truncated: rows.length >= limit,
    // Shipped with the payload so no consumer can render this feed without
    // the caveat being available to it.
    caveat:
      'Satellite thermal-anomaly detections (hot pixels), not confirmed fires. ' +
      'Many are routine industrial gas flares or agricultural burning. ' +
      'Attribution to any event or facility is inference. Cloud cover and ' +
      'overpass gaps mean no detection does not mean no fire.',
    data: mapped,
  });
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    if (PROVIDER !== 'supabase') {
      return NextResponse.json({ error: `Unknown FIRMS_PROVIDER: ${PROVIDER}` }, { status: 500 });
    }
    return await fetchFromSupabase(params);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
