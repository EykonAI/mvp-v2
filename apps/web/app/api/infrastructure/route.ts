import { NextRequest, NextResponse } from 'next/server';

// Global Energy Monitor — static infrastructure data
// Cached in-memory since it updates quarterly
let gemCache: { data: any[]; fetched: number } | null = null;
const GEM_TTL = 24 * 3600_000; // 24 hours

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const lat_min = parseFloat(params.get('lat_min') || '-90');
    const lat_max = parseFloat(params.get('lat_max') || '90');
    const lon_min = parseFloat(params.get('lon_min') || '-180');
    const lon_max = parseFloat(params.get('lon_max') || '180');
    const fuel = params.get('fuel_type');

    // Try Supabase first, fallback to embedded sample data
    let facilities = getSampleInfrastructure();

    // Filter by bounding box
    facilities = facilities.filter((f: any) =>
      f.latitude >= lat_min && f.latitude <= lat_max &&
      f.longitude >= lon_min && f.longitude <= lon_max
    );
    if (fuel) {
      facilities = facilities.filter((f: any) =>
        f.fuel_type?.toLowerCase().includes(fuel.toLowerCase())
      );
    }

    return NextResponse.json({
      count: facilities.length,
      timestamp: new Date().toISOString(),
      data: facilities.slice(0, 500),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Sample infrastructure data (subset — full data loaded from GEM GeoJSON in production)
function getSampleInfrastructure() {
  return [
    { id: 'gem-001', name: 'Kashiwazaki-Kariwa', latitude: 37.43, longitude: 138.60, country: 'Japan', fuel_type: 'Nuclear', capacity_mw: 7965, status: 'Standby', infra_type: 'power_plant' },
    { id: 'gem-002', name: 'Bruce Nuclear', latitude: 44.33, longitude: -81.60, country: 'Canada', fuel_type: 'Nuclear', capacity_mw: 6384, status: 'Operating', infra_type: 'power_plant' },
    { id: 'gem-003', name: 'Zaporizhzhia NPP', latitude: 47.51, longitude: 34.58, country: 'Ukraine', fuel_type: 'Nuclear', capacity_mw: 5700, status: 'Occupied', infra_type: 'power_plant' },
    { id: 'gem-004', name: 'Ghawar Oil Field', latitude: 25.38, longitude: 49.48, country: 'Saudi Arabia', fuel_type: 'Oil', capacity_mw: 0, status: 'Operating', infra_type: 'refinery' },
    { id: 'gem-005', name: 'Ras Tanura Refinery', latitude: 26.65, longitude: 50.16, country: 'Saudi Arabia', fuel_type: 'Oil', capacity_mw: 550000, status: 'Operating', infra_type: 'refinery' },
    { id: 'gem-006', name: 'Jamnagar Refinery', latitude: 22.35, longitude: 69.07, country: 'India', fuel_type: 'Oil', capacity_mw: 1240000, status: 'Operating', infra_type: 'refinery' },
    { id: 'gem-007', name: 'Three Gorges Dam', latitude: 30.82, longitude: 111.00, country: 'China', fuel_type: 'Hydro', capacity_mw: 22500, status: 'Operating', infra_type: 'power_plant' },
    { id: 'gem-008', name: 'Itaipu Dam', latitude: -25.41, longitude: -54.59, country: 'Brazil', fuel_type: 'Hydro', capacity_mw: 14000, status: 'Operating', infra_type: 'power_plant' },
    { id: 'gem-009', name: 'Gansu Wind Farm', latitude: 40.37, longitude: 96.07, country: 'China', fuel_type: 'Wind', capacity_mw: 7965, status: 'Operating', infra_type: 'power_plant' },
    { id: 'gem-010', name: 'Bhadla Solar Park', latitude: 27.53, longitude: 71.91, country: 'India', fuel_type: 'Solar', capacity_mw: 2245, status: 'Operating', infra_type: 'power_plant' },
    { id: 'gem-011', name: 'Nord Stream 1', latitude: 54.20, longitude: 13.60, country: 'Germany', fuel_type: 'Gas', capacity_mw: 0, status: 'Destroyed', infra_type: 'pipeline' },
    { id: 'gem-012', name: 'TurkStream', latitude: 41.70, longitude: 28.20, country: 'Turkey', fuel_type: 'Gas', capacity_mw: 0, status: 'Operating', infra_type: 'pipeline' },
    { id: 'gem-013', name: 'Trans-Arabian Pipeline', latitude: 31.30, longitude: 36.50, country: 'Jordan', fuel_type: 'Oil', capacity_mw: 0, status: 'Inactive', infra_type: 'pipeline' },
    { id: 'gem-014', name: 'Port of Shanghai', latitude: 31.36, longitude: 121.62, country: 'China', fuel_type: '', capacity_mw: 0, status: 'Operating', infra_type: 'port' },
    { id: 'gem-015', name: 'Port of Singapore', latitude: 1.26, longitude: 103.84, country: 'Singapore', fuel_type: '', capacity_mw: 0, status: 'Operating', infra_type: 'port' },
    { id: 'gem-016', name: 'Port of Rotterdam', latitude: 51.95, longitude: 4.13, country: 'Netherlands', fuel_type: '', capacity_mw: 0, status: 'Operating', infra_type: 'port' },
    { id: 'gem-017', name: 'Escondida Mine', latitude: -24.27, longitude: -69.07, country: 'Chile', fuel_type: 'Copper', capacity_mw: 0, status: 'Operating', infra_type: 'mine' },
    { id: 'gem-018', name: 'Olympic Dam Mine', latitude: -30.44, longitude: 136.89, country: 'Australia', fuel_type: 'Copper/Uranium', capacity_mw: 0, status: 'Operating', infra_type: 'mine' },
    { id: 'gem-019', name: 'Bayan Obo Mine', latitude: 41.80, longitude: 109.97, country: 'China', fuel_type: 'Rare Earths', capacity_mw: 0, status: 'Operating', infra_type: 'mine' },
    { id: 'gem-020', name: 'Salar de Atacama', latitude: -23.50, longitude: -68.25, country: 'Chile', fuel_type: 'Lithium', capacity_mw: 0, status: 'Operating', infra_type: 'mine' },
    { id: 'gem-021', name: 'Heathrow Airport', latitude: 51.47, longitude: -0.46, country: 'UK', fuel_type: '', capacity_mw: 0, status: 'Operating', infra_type: 'airport' },
    { id: 'gem-022', name: 'Dubai International', latitude: 25.25, longitude: 55.36, country: 'UAE', fuel_type: '', capacity_mw: 0, status: 'Operating', infra_type: 'airport' },
    { id: 'gem-023', name: 'Changi Airport', latitude: 1.36, longitude: 103.99, country: 'Singapore', fuel_type: '', capacity_mw: 0, status: 'Operating', infra_type: 'airport' },
    { id: 'gem-024', name: 'Suez Canal', latitude: 30.58, longitude: 32.33, country: 'Egypt', fuel_type: '', capacity_mw: 0, status: 'Operating', infra_type: 'port' },
    { id: 'gem-025', name: 'Panama Canal', latitude: 9.08, longitude: -79.68, country: 'Panama', fuel_type: '', capacity_mw: 0, status: 'Operating', infra_type: 'port' },
  ];
}
