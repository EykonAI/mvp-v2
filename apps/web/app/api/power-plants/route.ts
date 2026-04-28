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

      // Two-tier capacity thinning:
      //   zoom < 3  → ≥500 MW (~4,300 plants)
      //   zoom ≥ 3  → ≥200 MW (~10,000 plants)
      // Nuclear is exempted from the capacity floor — every operating
      // reactor shows at every zoom level since they're geopolitically
      // significant regardless of unit size (most are 600-900 MW per unit).
      const z = Number.isFinite(zoom) ? zoom : 0;
      const minMW = z < 3 ? 500 : 200;
      query = query.or(`capacity_mw.gte.${minMW},fuel_type.eq.nuclear`);
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
