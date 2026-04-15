import { NextRequest, NextResponse } from 'next/server';

// AISHub vessel data
export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.AISHUB_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AISHUB_API_KEY not configured' }, { status: 503 });
    }

    const params = req.nextUrl.searchParams;
    const urlParams = new URLSearchParams({
      username: apiKey,
      format: '1',
      output: 'json',
      compress: '0',
    });

    // Bounding box filter
    const latmin = params.get('latmin');
    const latmax = params.get('latmax');
    const lonmin = params.get('lonmin');
    const lonmax = params.get('lonmax');
    if (latmin) urlParams.set('latmin', latmin);
    if (latmax) urlParams.set('latmax', latmax);
    if (lonmin) urlParams.set('lonmin', lonmin);
    if (lonmax) urlParams.set('lonmax', lonmax);

    // MMSI filter
    const mmsi = params.get('mmsi');
    if (mmsi) urlParams.set('mmsi', mmsi);

    const res = await fetch(`https://data.aishub.net/ws.php?${urlParams.toString()}`, {
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `AISHub API error: ${res.status}` }, { status: 502 });
    }

    const json = await res.json();

    // AISHub returns an array where [0] is metadata and [1] is data
    const vessels = Array.isArray(json) && json.length > 1 ? json[1] : (json.data || json || []);

    return NextResponse.json({
      count: vessels.length,
      timestamp: new Date().toISOString(),
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
