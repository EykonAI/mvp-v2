import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// OSM-backed refineries feed. Bbox-filtered SELECT from the `refineries`
// table populated by /api/cron/ingest-osm-refineries (or the local seed
// script). Mirrors the /api/ports response shape — no zoom thinning,
// since the global count (~1k–1.5k) is already manageable.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const lat_min = parseFloat(params.get('lat_min') || '-90');
    const lat_max = parseFloat(params.get('lat_max') || '90');
    const lon_min = parseFloat(params.get('lon_min') || '-180');
    const lon_max = parseFloat(params.get('lon_max') || '180');
    const country = params.get('country');
    const limit = Math.min(parseInt(params.get('limit') || '2000'), 5000);

    const supabase = createServerSupabase();
    let query = supabase
      .from('refineries')
      .select('id,osm_type,osm_id,refinery_name,operator,owner,product,capacity_bpd,start_date,country,iso_country,city,wiki_url,latitude,longitude')
      .gte('latitude', lat_min)
      .lte('latitude', lat_max)
      .gte('longitude', lon_min)
      .lte('longitude', lon_max)
      .limit(limit);

    if (country) {
      const c = country.toUpperCase();
      query = query.or(`iso_country.eq.${c},country.ilike.%${country}%`);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
    }

    return NextResponse.json({
      count: data?.length ?? 0,
      timestamp: new Date().toISOString(),
      provider: 'osm-overpass',
      attribution: '© OpenStreetMap contributors (ODbL)',
      data: data ?? [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
