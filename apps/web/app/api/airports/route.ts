import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// Static airports feed backed by Supabase `airports` (OurAirports CSV ingest).
//
// Default response is the *significant* subset — large airports, plus medium
// airports with scheduled commercial service (~7,500 globally). Pass
// ?include_minor=true to return the full ~67k dataset (used by the AI analyst
// for proximity queries; rarely useful on the map).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const lat_min = parseFloat(params.get('lat_min') || '-90');
    const lat_max = parseFloat(params.get('lat_max') || '90');
    const lon_min = parseFloat(params.get('lon_min') || '-180');
    const lon_max = parseFloat(params.get('lon_max') || '180');
    const includeMinor = params.get('include_minor') === 'true';
    const limit = Math.min(parseInt(params.get('limit') || '8000'), 20000);

    const supabase = createServerSupabase();
    let query = supabase
      .from('airports')
      .select('id,ident,type,name,latitude,longitude,elevation_ft,iso_country,municipality,scheduled_service,iata_code,icao_code')
      .gte('latitude', lat_min)
      .lte('latitude', lat_max)
      .gte('longitude', lon_min)
      .lte('longitude', lon_max)
      .limit(limit);

    if (!includeMinor) {
      // "Significant" = large airports (always) + medium airports with
      // scheduled commercial service. Yields ~7,500 worldwide.
      query = query.or('type.eq.large_airport,and(type.eq.medium_airport,scheduled_service.eq.true)');
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
    }

    return NextResponse.json({
      count: data?.length ?? 0,
      timestamp: new Date().toISOString(),
      provider: 'ourairports',
      data: data ?? [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
