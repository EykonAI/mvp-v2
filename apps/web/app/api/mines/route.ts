import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// USGS MRDS-backed mines feed. Bbox-filtered SELECT from the `mines`
// table populated by /api/cron/ingest-usgs-mrds-mines (or the local seed
// script). MRDS is large (304k records globally) — by default we surface
// only meaningful sites: dev_stat IN (Producer, Past Producer, Plant)
// AND a known commod1. Pass ?include_minor=true to lift both filters.
//
// Common analyst slices:
//   ?commodity=Copper        — match commodities[] array
//   ?commodity=Lithium       — strategic metals filter
//   ?dev_stat=Producer       — currently producing only
//   ?country=Chile           — case-insensitive country contains

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGNIFICANT_DEV_STATS = ['Producer', 'Past Producer', 'Plant'];

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const lat_min = parseFloat(params.get('lat_min') || '-90');
    const lat_max = parseFloat(params.get('lat_max') || '90');
    const lon_min = parseFloat(params.get('lon_min') || '-180');
    const lon_max = parseFloat(params.get('lon_max') || '180');
    const includeMinor = params.get('include_minor') === 'true';
    const commodity = params.get('commodity');
    const devStat = params.get('dev_stat');
    const country = params.get('country');
    const limit = Math.min(parseInt(params.get('limit') || '5000'), 20000);

    const supabase = createServerSupabase();
    let query = supabase
      .from('mines')
      .select('id,site_name,dev_stat,country,iso_country,state,county,commod1,commod2,commod3,commodities,ore,dep_type,url,latitude,longitude')
      .gte('latitude', lat_min)
      .lte('latitude', lat_max)
      .gte('longitude', lon_min)
      .lte('longitude', lon_max)
      .limit(limit);

    if (!includeMinor) {
      query = query.in('dev_stat', SIGNIFICANT_DEV_STATS).not('commod1', 'is', null);
    }
    if (devStat) query = query.eq('dev_stat', devStat);
    if (commodity) query = query.contains('commodities', [commodity]);
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
      provider: 'usgs-mrds',
      attribution: 'U.S. Geological Survey — Mineral Resources Data System (public domain; archival snapshot, last updated 2011)',
      data: data ?? [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
