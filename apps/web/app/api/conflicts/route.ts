import { NextRequest, NextResponse } from 'next/server';

const ACLED_TOKEN_URL = 'https://acleddata.com/oauth/token';
const ACLED_READ_URL = 'https://acleddata.com/api/acled/read';

// ACLED token cache
let acledToken: { access: string; refresh: string; expires: number } | null = null;

async function postForm(url: string, fields: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams(fields).toString();
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

async function getAcledToken(): Promise<string> {
  const username = process.env.ACLED_EMAIL;
  const password = process.env.ACLED_API_KEY;
  if (!username || !password) throw new Error('ACLED credentials not configured');

  // Reuse cached token if still valid (with 5-min buffer)
  if (acledToken && Date.now() < acledToken.expires - 300_000) {
    return acledToken.access;
  }

  // Try refresh first
  if (acledToken?.refresh) {
    try {
      const res = await postForm(ACLED_TOKEN_URL, {
        grant_type: 'refresh_token',
        refresh_token: acledToken.refresh,
        client_id: 'acled',
      });
      if (res.ok) {
        const data = await res.json();
        acledToken = {
          access: data.access_token,
          refresh: data.refresh_token || acledToken.refresh,
          expires: Date.now() + (data.expires_in ?? 86400) * 1000,
        };
        return acledToken.access;
      }
    } catch {}
  }

  // Full password-grant login
  const res = await postForm(ACLED_TOKEN_URL, {
    username,
    password,
    grant_type: 'password',
    client_id: 'acled',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ACLED login failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  acledToken = {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + (data.expires_in ?? 86400) * 1000,
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

    const res = await fetch(`${ACLED_READ_URL}?${queryParams.toString()}`, {
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
