import { NextRequest, NextResponse } from 'next/server';

// ADS-B data from adsb.lol (free, no key required)
export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const lat_min = params.get('lat_min');
    const lat_max = params.get('lat_max');
    const lon_min = params.get('lon_min');
    const lon_max = params.get('lon_max');

    // Default: global feed
    let url = 'https://api.adsb.lol/v2/lat/20/lon/20/dist/25000';

    // If bounding box provided, use it for filtering client-side
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 10 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `ADS-B API error: ${res.status}` }, { status: 502 });
    }

    const json = await res.json();
    let aircraft = json.ac || [];

    // Filter by bounding box if provided
    if (lat_min && lat_max && lon_min && lon_max) {
      const bounds = {
        lat_min: parseFloat(lat_min),
        lat_max: parseFloat(lat_max),
        lon_min: parseFloat(lon_min),
        lon_max: parseFloat(lon_max),
      };
      aircraft = aircraft.filter((a: any) => {
        const lat = a.lat;
        const lon = a.lon;
        return lat >= bounds.lat_min && lat <= bounds.lat_max &&
               lon >= bounds.lon_min && lon <= bounds.lon_max;
      });
    }

    return NextResponse.json({
      count: aircraft.length,
      timestamp: new Date().toISOString(),
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
