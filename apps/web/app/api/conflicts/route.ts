import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// Provider selection:
//   CONFLICT_PROVIDER=acled   -> live proxy to ACLED (requires paid license)
//   default / "supabase"      -> read conflict_events from Supabase
//                                (populated by the GDELT ingestion cron)
const PROVIDER = (process.env.CONFLICT_PROVIDER || 'supabase').toLowerCase();

// ─── ACLED live proxy (preserved for future paid-license activation) ─────────
const ACLED_TOKEN_URL = 'https://acleddata.com/oauth/token';
const ACLED_READ_URL = 'https://acleddata.com/api/acled/read';

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

  if (acledToken && Date.now() < acledToken.expires - 300_000) {
    return acledToken.access;
  }

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

async function fetchFromAcled(params: URLSearchParams) {
  const country = params.get('country');
  const days = parseInt(params.get('days') || '30');
  const eventType = params.get('event_type');
  const limit = parseInt(params.get('limit') || '500');

  const token = await getAcledToken();

  const q = new URLSearchParams({ limit: String(limit) });
  if (country) q.set('country', country);
  if (eventType) q.set('event_type', eventType);

  const since = new Date(Date.now() - days * 86_400_000);
  q.set('event_date', since.toISOString().split('T')[0]);
  q.set('event_date_where', '>=');

  const lat_min = params.get('lat_min');
  if (lat_min) {
    q.set('latitude', `${lat_min}|${params.get('lat_max')}`);
    q.set('latitude_where', 'BETWEEN');
    q.set('longitude', `${params.get('lon_min')}|${params.get('lon_max')}`);
    q.set('longitude_where', 'BETWEEN');
  }

  const res = await fetch(`${ACLED_READ_URL}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    if (res.status === 401) acledToken = null;
    return NextResponse.json({ error: `ACLED API error: ${res.status}` }, { status: 502 });
  }

  const json = await res.json();
  const events = json.data || [];

  return NextResponse.json({
    count: events.length,
    timestamp: new Date().toISOString(),
    provider: 'acled',
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
}

// ─── Supabase read (default — serves GDELT-ingested rows) ────────────────────
async function fetchFromSupabase(params: URLSearchParams) {
  const country = params.get('country');
  const days = parseInt(params.get('days') || '30');
  const eventType = params.get('event_type');
  const limit = Math.min(parseInt(params.get('limit') || '500'), 5000);

  const supabase = createServerSupabase();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];

  let query = supabase
    .from('conflict_events')
    .select('event_id,event_type,country,latitude,longitude,event_date,actor1,actor2,fatalities,notes,source')
    .gte('event_date', since)
    .order('event_date', { ascending: false })
    .limit(limit);

  if (country) query = query.eq('country', country);
  if (eventType) query = query.eq('event_type', eventType);

  const lat_min = params.get('lat_min');
  if (lat_min) {
    query = query
      .gte('latitude', parseFloat(lat_min))
      .lte('latitude', parseFloat(params.get('lat_max') || '90'))
      .gte('longitude', parseFloat(params.get('lon_min') || '-180'))
      .lte('longitude', parseFloat(params.get('lon_max') || '180'));
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
  }

  return NextResponse.json({
    count: data?.length ?? 0,
    timestamp: new Date().toISOString(),
    provider: 'supabase',
    data: data ?? [],
  });
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    if (PROVIDER === 'acled') return await fetchFromAcled(params);
    return await fetchFromSupabase(params);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
