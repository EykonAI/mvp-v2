import { NextRequest, NextResponse } from 'next/server';

// ACLED token cache
let acledToken: { access: string; refresh: string; expires: number } | null = null;

async function getAcledToken(): Promise<string> {
  const email = process.env.ACLED_EMAIL;
  const password = process.env.ACLED_API_KEY;
  if (!email || !password) throw new Error('ACLED credentials not configured');

  // Check if token is still valid (with 5-min buffer)
  if (acledToken && Date.now() < acledToken.expires - 300_000) {
    return acledToken.access;
  }

  // Try refresh first
  if (acledToken?.refresh) {
    try {
      const res = await fetch('https://api.acleddata.com/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${acledToken.refresh}` },
      });
      if (res.ok) {
        const data = await res.json();
        acledToken = {
          access: data.access_token,
          refresh: data.refresh_token || acledToken.refresh,
          expires: Date.now() + 24 * 3600_000,
        };
        return acledToken.access;
      }
    } catch {}
  }

  // Full login
  const res = await fetch('https://api.acleddata.com/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`ACLED login failed: ${res.status}`);
  const data = await res.json();
  acledToken = {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + 24 * 3600_000,
  };
  return acledToken.access;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const country = params.get('country');
    const days = parseInt(params.get('days') || '30');
    const eventType = params.get('event_type');
    const limit = parseInt(params.get('limit') || '500');

    const token = await getAcledToken();

    const queryParams = new URLSearchParams({ limit: String(limit) });

    if (country) queryParams.set('country', country);
    if (eventType) queryParams.set('event_type', eventType);

    // Date filter
    const since = new Date(Date.now() - days * 86_400_000);
    const sinceStr = since.toISOString().split('T')[0];
    queryParams.set('event_date', sinceStr);
    queryParams.set('event_date_where', '>=');

    // Bounding box
    const lat_min = params.get('lat_min');
    if (lat_min) {
      queryParams.set('latitude', `${lat_min}|${params.get('lat_max')}`);
      queryParams.set('latitude_where', 'BETWEEN');
      queryParams.set('longitude', `${params.get('lon_min')}|${params.get('lon_max')}`);
      queryParams.set('longitude_where', 'BETWEEN');
    }

    const res = await fetch(`https://api.acleddata.com/acled/read?${queryParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      // Clear token on auth failure
      if (res.status === 401) acledToken = null;
      return NextResponse.json({ error: `ACLED API error: ${res.status}` }, { status: 502 });
    }

    const json = await res.json();
    const events = json.data || [];

    return NextResponse.json({
      count: events.length,
      timestamp: new Date().toISOString(),
      data: events.map((e: any) => ({
        event_id: e.data_id || e.event_id_cnty,
        event_type: e.event_type,
        sub_event_type: e.sub_event_type,
        country: e.country,
        latitude: parseFloat(e.latitude),
        longitude: parseFloat(e.longitude),
        event_date: e.event_date,
        actor1: e.actor1,
        actor2: e.actor2,
        fatalities: parseInt(e.fatalities) || 0,
        notes: e.notes,
        source: e.source,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
