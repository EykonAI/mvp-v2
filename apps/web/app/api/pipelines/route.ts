import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// Combined Pipelines feed — backs the single "Pipelines" sub-layer with
// data from two different tables:
//   - gas_pipelines  : LineString / MultiLineString routes (GGIT)
//   - lng_terminals  : Point markers (GGIT terminals)
//
// Each returned item carries an `infra_subtype` discriminator
// ('pipeline' | 'lng_terminal') so MapView can route to the correct
// layer (PathLayer vs TextLayer).
//
// Default behaviour: status='operating' AND viewport bbox.
// Pass ?include_minor=true to bypass the status filter.

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
    const status = params.get('status');
    const facilityType = params.get('facility_type');
    const limit = Math.min(parseInt(params.get('limit') || '2000'), 5000);

    const supabase = createServerSupabase();

    // ─── Pipelines (bbox-overlap filter on precomputed bbox columns) ───
    let pq = supabase
      .from('gas_pipelines')
      .select('id,pipeline_name,segment_name,wiki_url,status,fuel,countries,owner,parent,start_year,capacity_bcm_y,length_km,start_country,end_country,route_accuracy,route_geojson,bbox_lat_min,bbox_lat_max,bbox_lon_min,bbox_lon_max')
      .lt('bbox_lat_min', lat_max)
      .gt('bbox_lat_max', lat_min)
      .lt('bbox_lon_min', lon_max)
      .gt('bbox_lon_max', lon_min)
      .limit(limit);
    if (!includeMinor) pq = pq.eq('status', status || 'operating');
    else if (status) pq = pq.eq('status', status);

    // ─── LNG Terminals (point bbox filter) ───
    let tq = supabase
      .from('lng_terminals')
      .select('id,project_id,terminal_name,unit_name,wiki_url,facility_type,fuel,status,country,region,capacity_mtpa,capacity_bcm_y,owner,parent,operator,start_year,offshore,floating,latitude,longitude')
      .gte('latitude', lat_min)
      .lte('latitude', lat_max)
      .gte('longitude', lon_min)
      .lte('longitude', lon_max)
      .limit(limit);
    if (!includeMinor) tq = tq.eq('status', status || 'operating');
    else if (status) tq = tq.eq('status', status);
    if (facilityType) tq = tq.eq('facility_type', facilityType);

    const [pRes, tRes] = await Promise.all([pq, tq]);
    if (pRes.error) {
      return NextResponse.json({ error: `pipelines: ${pRes.error.message}` }, { status: 502 });
    }
    if (tRes.error) {
      return NextResponse.json({ error: `lng_terminals: ${tRes.error.message}` }, { status: 502 });
    }

    const pipelines = (pRes.data ?? []).map((p) => ({ ...p, infra_subtype: 'pipeline' }));
    const terminals = (tRes.data ?? []).map((t) => ({ ...t, infra_subtype: 'lng_terminal' }));

    return NextResponse.json({
      count: pipelines.length + terminals.length,
      pipelines_count: pipelines.length,
      terminals_count: terminals.length,
      timestamp: new Date().toISOString(),
      provider: 'gem-ggit',
      attribution: 'Global Energy Monitor — Global Gas Infrastructure Tracker (CC BY 4.0)',
      data: [...pipelines, ...terminals],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
