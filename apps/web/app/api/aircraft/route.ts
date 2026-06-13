import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// Aircraft positions. Mirrors the /api/vessels provider pattern:
//   AIRCRAFT_PROVIDER=adsblol -> live proxy to adsb.lol (LOCAL/DEV ONLY:
//                                adsb.lol blocks datacenter egress IPs, so
//                                this 502s from Railway — see
//                                services/adsb-ingest for the saga).
//   default / "supabase"      -> read aircraft_positions from Supabase,
//                                populated by services/adsb-ingest (OpenSky).
//
// Citizen 24h feed-delay (trial-mechanism brief §5.4): aircraft_positions is
// upsert-keyed on icao24, so it holds only each aircraft's LATEST position —
// there is no historical time-series to snapshot from 24h ago the way
// /api/vessels and /api/conflicts do. Citizens therefore continue to see live
// aircraft as the documented exception, now sourced from our own fresh table
// instead of a blocked third-party proxy. Removing the per-request live call
// also makes the Globe's Aircraft layer reliable (same model as Vessels) and
// degrades honestly: when the table is empty the layer is simply empty rather
// than erroring.

const PROVIDER = (process.env.AIRCRAFT_PROVIDER || 'supabase').toLowerCase();
const FRESH_WINDOW_MS = 60 * 60 * 1000; // only return aircraft seen in the last hour

async function fetchFromSupabase(params: URLSearchParams) {
  const supabase = createServerSupabase();
  const limit = Math.min(parseInt(params.get('limit') || '5000'), 20000);
  const sinceISO = new Date(Date.now() - FRESH_WINDOW_MS).toISOString();

  let query = supabase
    .from('aircraft_positions')
    .select('icao24,callsign,latitude,longitude,altitude,velocity,heading,on_ground,country,squawk,ingested_at')
    .gte('ingested_at', sinceISO)
    .order('ingested_at', { ascending: false })
    .limit(limit);

  // Bounding box — accept both this route's historical spelling (lat_min)
  // and the vessels-route spelling (latmin) so any caller keeps working.
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

  return NextResponse.json({
    count: data?.length ?? 0,
    timestamp: new Date().toISOString(),
    provider: 'supabase',
    data: (data ?? []).map((a: any) => ({
      icao24: a.icao24,
      callsign: (a.callsign || '').trim(),
      latitude: a.latitude,
      longitude: a.longitude,
      altitude: a.altitude ?? 0,
      velocity: a.velocity ?? null,
      heading: a.heading ?? null,
      on_ground: a.on_ground ?? false,
      country: a.country || '',
      squawk: a.squawk || '',
      // Not stored in aircraft_positions (came from adsb.lol's `t` / dbFlags).
      // Kept in the response shape so the Globe contract is unchanged; military
      // highlighting is the one minor regression vs the old proxy — revisit by
      // adding columns to the ingest worker + migration if it's wanted back.
      type: '',
      military: false,
      updated_at: a.ingested_at,
    })),
  });
}

// ─── adsb.lol live proxy (preserved for local/dev; 502s from Railway) ──
async function fetchFromAdsblol(params: URLSearchParams) {
  const res = await fetch('https://api.adsb.lol/v2/lat/20/lon/20/dist/25000', {
    headers: { Accept: 'application/json' },
    next: { revalidate: 10 },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `ADS-B API error: ${res.status}` }, { status: 502 });
  }
  const json = await res.json();
  let aircraft = json.ac || [];

  const lat_min = params.get('lat_min');
  const lat_max = params.get('lat_max');
  const lon_min = params.get('lon_min');
  const lon_max = params.get('lon_max');
  if (lat_min && lat_max && lon_min && lon_max) {
    const b = {
      lat_min: parseFloat(lat_min), lat_max: parseFloat(lat_max),
      lon_min: parseFloat(lon_min), lon_max: parseFloat(lon_max),
    };
    aircraft = aircraft.filter((a: any) =>
      a.lat >= b.lat_min && a.lat <= b.lat_max && a.lon >= b.lon_min && a.lon <= b.lon_max);
  }

  return NextResponse.json({
    count: aircraft.length,
    timestamp: new Date().toISOString(),
    provider: 'adsblol',
    data: aircraft.map((a: any) => ({
      icao24: a.hex,
      callsign: (a.flight || '').trim(),
      latitude: a.lat,
      longitude: a.lon,
      altitude: a.alt_baro === 'ground' ? 0 : a.alt_baro,
      velocity: a.gs,
      heading: a.track,
      on_ground: a.alt_baro === 'ground',
      country: a.r || '',
      squawk: a.squawk,
      type: a.t || '',
      military: a.dbFlags === 1,
    })),
  });
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    if (PROVIDER === 'adsblol') return await fetchFromAdsblol(params);
    return await fetchFromSupabase(params);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
