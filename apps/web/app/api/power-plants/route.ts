import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// GIPT-backed power plants feed.
//
// Default behaviour: status='operating' AND capacity-thinned by zoom so the
// globe doesn't drown in 100k+ utility-scale solar units. Bypass either with
// ?include_minor=true (returns every status / every size) or ?fuel=… /
// ?status=… for explicit slicing (used by the AI analyst tool layer).

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
    const fuel = params.get('fuel');
    const statusOverride = params.get('status');
    const zoomStr = params.get('zoom');
    const zoom = zoomStr !== null ? parseFloat(zoomStr) : NaN;
    const limit = Math.min(parseInt(params.get('limit') || '8000'), 20000);

    const supabase = createServerSupabase();
    let query = supabase
      .from('power_plants')
      .select('id,plant_name,unit_name,fuel_type,technology,capacity_mw,status,start_year,country,subnational_unit,owner,operator,gem_wiki_url,latitude,longitude')
      .gte('latitude', lat_min)
      .lte('latitude', lat_max)
      .gte('longitude', lon_min)
      .lte('longitude', lon_max)
      .limit(limit);

    if (!includeMinor) {
      // Default: operating only. Override via ?status=… for analytical
      // queries ("show retired plants in Germany since 2015").
      query = query.eq('status', statusOverride || 'operating');

      // Capacity thinning by zoom. Threshold rationale (verified against
      // the March 2026 release):
      //   zoom < 3  → ≥1 GW OR nuclear OR geothermal      ~1,700 plants
      //   zoom ≥ 3  → ≥100 MW OR nuclear OR geothermal   ~20,000 plants
      // Nuclear and geothermal stay visible regardless of capacity because
      // they are strategic regardless of size.
      if (Number.isFinite(zoom) && zoom < 3) {
        query = query.or('capacity_mw.gte.1000,fuel_type.eq.nuclear,fuel_type.eq.geothermal');
      } else {
        query = query.or('capacity_mw.gte.100,fuel_type.eq.nuclear,fuel_type.eq.geothermal');
      }
    } else if (statusOverride) {
      query = query.eq('status', statusOverride);
    }

    if (fuel) query = query.eq('fuel_type', fuel);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 502 });
    }

    return NextResponse.json({
      count: data?.length ?? 0,
      timestamp: new Date().toISOString(),
      provider: 'gem-gipt',
      attribution: 'Global Energy Monitor — Global Integrated Power Tracker (CC BY 4.0)',
      data: data ?? [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
