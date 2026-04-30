import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// Combined Pipelines feed — backs the single "Pipelines" sub-layer with
// data from three different tables:
//   - gas_pipelines  : LineString / MultiLineString routes (GEM GGIT)
//   - oil_pipelines  : LineString / MultiLineString routes (GEM GOIT)
//   - lng_terminals  : Point markers (GEM GGIT terminals)
//
// Each returned item carries an `infra_subtype` discriminator
// ('pipeline_gas' | 'pipeline_oil' | 'lng_terminal') so MapView can
// route to the correct layer (PathLayer vs TextLayer) and so
// downstream callers can filter by fuel without re-parsing the `fuel`
// string.
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
    const fuel = params.get('fuel'); // 'gas' | 'oil' | undefined
    const limit = Math.min(parseInt(params.get('limit') || '2000'), 5000);

    const supabase = createServerSupabase();

    // ─── Gas pipelines (GGIT, bbox-overlap on precomputed bbox columns) ───
    const wantGas = !fuel || fuel === 'gas';
    let pq = wantGas ? supabase
      .from('gas_pipelines')
      .select('id,pipeline_name,segment_name,wiki_url,status,fuel,countries,owner,parent,start_year,capacity_bcm_y,length_km,start_country,end_country,route_accuracy,route_geojson,bbox_lat_min,bbox_lat_max,bbox_lon_min,bbox_lon_max')
      .lt('bbox_lat_min', lat_max)
      .gt('bbox_lat_max', lat_min)
      .lt('bbox_lon_min', lon_max)
      .gt('bbox_lon_max', lon_min)
      .limit(limit) : null;
    if (pq) {
      if (!includeMinor) pq = pq.eq('status', status || 'operating');
      else if (status) pq = pq.eq('status', status);
    }

    // ─── Oil pipelines (GOIT, same bbox shape as gas_pipelines) ───
    const wantOil = !fuel || fuel === 'oil';
    let oq = wantOil ? supabase
      .from('oil_pipelines')
      .select('id,pipeline_name,segment_name,wiki_url,status,fuel,countries,owner,parent,start_year,capacity_boed,capacity_raw,capacity_units,length_km,start_country,end_country,route_accuracy,route_geojson,bbox_lat_min,bbox_lat_max,bbox_lon_min,bbox_lon_max')
      .lt('bbox_lat_min', lat_max)
      .gt('bbox_lat_max', lat_min)
      .lt('bbox_lon_min', lon_max)
      .gt('bbox_lon_max', lon_min)
      .limit(limit) : null;
    if (oq) {
      if (!includeMinor) oq = oq.eq('status', status || 'operating');
      else if (status) oq = oq.eq('status', status);
    }

    // ─── LNG terminals (point bbox filter) ───
    const wantTerminals = !fuel || fuel === 'gas';
    let tq = wantTerminals ? supabase
      .from('lng_terminals')
      .select('id,project_id,terminal_name,unit_name,wiki_url,facility_type,fuel,status,country,region,capacity_mtpa,capacity_bcm_y,owner,parent,operator,start_year,offshore,floating,latitude,longitude')
      .gte('latitude', lat_min)
      .lte('latitude', lat_max)
      .gte('longitude', lon_min)
      .lte('longitude', lon_max)
      .limit(limit) : null;
    if (tq) {
      if (!includeMinor) tq = tq.eq('status', status || 'operating');
      else if (status) tq = tq.eq('status', status);
      if (facilityType) tq = tq.eq('facility_type', facilityType);
    }

    const [pRes, oRes, tRes] = await Promise.all([
      pq ?? Promise.resolve({ data: [], error: null }),
      oq ?? Promise.resolve({ data: [], error: null }),
      tq ?? Promise.resolve({ data: [], error: null }),
    ]);
    if (pRes.error) return NextResponse.json({ error: `gas_pipelines: ${pRes.error.message}` }, { status: 502 });
    if (oRes.error) return NextResponse.json({ error: `oil_pipelines: ${oRes.error.message}` }, { status: 502 });
    if (tRes.error) return NextResponse.json({ error: `lng_terminals: ${tRes.error.message}` }, { status: 502 });

    const gas = (pRes.data ?? []).map((p) => ({ ...p, infra_subtype: 'pipeline_gas' }));
    const oil = (oRes.data ?? []).map((p) => ({ ...p, infra_subtype: 'pipeline_oil' }));
    const terminals = (tRes.data ?? []).map((t) => ({ ...t, infra_subtype: 'lng_terminal' }));

    return NextResponse.json({
      count: gas.length + oil.length + terminals.length,
      gas_pipelines_count: gas.length,
      oil_pipelines_count: oil.length,
      terminals_count: terminals.length,
      // Back-compat alias for callers built against the gas-only response.
      pipelines_count: gas.length + oil.length,
      timestamp: new Date().toISOString(),
      provider: 'gem-ggit+goit',
      attribution: 'Global Energy Monitor — GGIT (gas) + GOIT (oil) + LNG Terminals (CC BY 4.0)',
      data: [...gas, ...oil, ...terminals],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
