import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// Static ports feed backed by Supabase `ports` (NGA WPI ingest).
// ~3,700 ports total — the registry is curated, so default returns all
// matching the bbox.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const lat_min = parseFloat(params.get('lat_min') || '-90');
    const lat_max = parseFloat(params.get('lat_max') || '90');
    const lon_min = parseFloat(params.get('lon_min') || '-180');
    const lon_max = parseFloat(params.get('lon_max') || '180');
    const harborSize = params.get('harbor_size'); // 'Very Small' | 'Small' | 'Medium' | 'Large'
    const zoomStr = params.get('zoom');
    const zoom = zoomStr !== null ? parseFloat(zoomStr) : NaN;
    const limit = Math.min(parseInt(params.get('limit') || '5000'), 20000);

    const supabase = createServerSupabase();
    let query = supabase
      .from('ports')
      .select('id,port_name,country,unlocode,harbor_size,harbor_type,shelter,channel_depth_m,repairs,latitude,longitude')
      .gte('latitude', lat_min)
      .lte('latitude', lat_max)
      .gte('longitude', lon_min)
      .lte('longitude', lon_max)
      .limit(limit);

    if (harborSize) {
      query = query.eq('harbor_size', harborSize);
    } else if (Number.isFinite(zoom) && zoom < 3) {
      // Globe view: thin to Large + Medium harbors. Pub 150 uses full
      // English labels ('Very Small' | 'Small' | 'Medium' | 'Large').
      // 'Large' alone is only ~174 ports globally — too sparse on a world
      // view; adding Medium (~370 more) gives a populated coastline
      // without re-introducing the overcrowding problem from the
      // ~3,800-port full set.
      query = query.in('harbor_size', ['Large', 'Medium']);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
    }

    return NextResponse.json({
      count: data?.length ?? 0,
      timestamp: new Date().toISOString(),
      provider: 'nga-wpi',
      data: data ?? [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
