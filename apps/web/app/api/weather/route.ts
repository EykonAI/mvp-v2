import { NextRequest, NextResponse } from 'next/server';

// Open-Meteo — free, no API key required
export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const lat = params.get('latitude') || '48.85';
    const lon = params.get('longitude') || '2.35';

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code&timezone=auto`;

    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return NextResponse.json({ error: `Open-Meteo error: ${res.status}` }, { status: 502 });

    const data = await res.json();
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      location: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
      current: data.current,
      units: data.current_units,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
