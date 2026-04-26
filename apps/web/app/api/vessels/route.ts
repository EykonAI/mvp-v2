import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// Provider selection mirrors the conflicts pattern:
//   VESSEL_PROVIDER=aishub    -> live proxy to AIS Hub (requires feeder station)
//   default / "supabase"      -> read vessel_positions from Supabase
//                                (populated by services/ais-ingest)
const PROVIDER = (process.env.VESSEL_PROVIDER || 'supabase').toLowerCase();

const FRESH_WINDOW_MS = 60 * 60 * 1000; // only return vessels seen in last hour

async function fetchFromSupabase(params: URLSearchParams) {
  const supabase = createServerSupabase();

  const limit = Math.min(parseInt(params.get('limit') || '5000'), 20000);
  const since = new Date(Date.now() - FRESH_WINDOW_MS).toISOString();

  let query = supabase
    .from('vessel_positions')
    .select('mmsi,name,vessel_type,latitude,longitude,speed,heading,course,destination,callsign,flag,imo,nav_status,updated_at')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(limit);

  const latmin = params.get('latmin');
  if (latmin) {
    query = query
      .gte('latitude',  parseFloat(latmin))
      .lte('latitude',  parseFloat(params.get('latmax') || '90'))
      .gte('longitude', parseFloat(params.get('lonmin') || '-180'))
      .lte('longitude', parseFloat(params.get('lonmax') || '180'));
  }

  const mmsi = params.get('mmsi');
  if (mmsi) query = query.eq('mmsi', mmsi);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
  }

  return NextResponse.json({
    count: data?.length ?? 0,
    timestamp: new Date().toISOString(),
    provider: 'supabase',
    data: (data ?? []).map((v: any) => ({
      mmsi: String(v.mmsi),
      name: v.name || 'Unknown',
      type: v.vessel_type ?? 0,
      latitude: v.latitude,
      longitude: v.longitude,
      speed: v.speed ?? 0,
      heading: v.heading ?? 0,
      course: v.course ?? null,
      destination: v.destination || '',
      callsign: v.callsign || '',
      flag: v.flag || '',
      imo: v.imo || '',
      updated_at: v.updated_at,
    })),
  });
}

// ─── AIS Hub live proxy (preserved for feeder-station setups) ──
async function fetchFromAishub(params: URLSearchParams) {
  const apiKey = process.env.AISHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ count: 0, timestamp: new Date().toISOString(), data: [], note: 'AISHUB_API_KEY not configured' });
  }

  const urlParams = new URLSearchParams({
    username: apiKey,
    format: '1',
    output: 'json',
    compress: '0',
  });
  for (const k of ['latmin', 'latmax', 'lonmin', 'lonmax', 'mmsi']) {
    const v = params.get(k);
    if (v) urlParams.set(k, v);
  }

  const res = await fetch(`https://data.aishub.net/ws.php?${urlParams.toString()}`, {
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `AISHub API error: ${res.status}` }, { status: 502 });
  }

  const json = await res.json();
  const vessels = Array.isArray(json) && json.length > 1 ? json[1] : (json.data || json || []);

  return NextResponse.json({
    count: vessels.length,
    timestamp: new Date().toISOString(),
    provider: 'aishub',
    data: Array.isArray(vessels) ? vessels.map((v: any) => ({
      mmsi: String(v.MMSI || v.mmsi),
      name: v.NAME || v.name || 'Unknown',
      type: v.TYPE || v.type || 0,
      latitude: v.LATITUDE || v.latitude,
      longitude: v.LONGITUDE || v.longitude,
      speed: v.SOG || v.sog || 0,
      heading: v.HEADING || v.heading || 0,
      destination: v.DESTINATION || v.destination || '',
      callsign: v.CALLSIGN || v.callsign || '',
    })) : [],
  });
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    if (PROVIDER === 'aishub') return await fetchFromAishub(params);
    return await fetchFromSupabase(params);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
