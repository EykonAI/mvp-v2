import { NextRequest, NextResponse } from 'next/server';

// ENTSO-E Transparency Platform — Real-time generation by fuel type
export async function GET(req: NextRequest) {
  try {
    const token = process.env.ENTSOE_API_KEY;
    if (!token) {
      // Return mock data structure when key not configured
      return NextResponse.json({
        count: 0,
        timestamp: new Date().toISOString(),
        data: [],
        note: 'ENTSOE_API_KEY not configured. Register at https://transparency.entsoe.eu/',
      });
    }

    const params = req.nextUrl.searchParams;
    const country = params.get('country') || '10Y1001A1001A83F'; // Germany default

    // Time range: last 24 hours
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 3600_000);
    const periodStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const periodEnd = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const apiUrl = `https://web-api.tp.entsoe.eu/api?` +
      `securityToken=${token}` +
      `&documentType=A75` + // Actual generation per type
      `&processType=A16` +  // Realised
      `&in_Domain=${country}` +
      `&periodStart=${periodStart}` +
      `&periodEnd=${periodEnd}`;

    const res = await fetch(apiUrl, { next: { revalidate: 300 } });

    if (!res.ok) {
      return NextResponse.json({ error: `ENTSO-E API error: ${res.status}` }, { status: 502 });
    }

    // ENTSO-E returns XML — parse the key fields
    const xml = await res.text();

    // Simple XML extraction for generation values
    const entries: any[] = [];
    const timeSeriesMatches = xml.match(/<TimeSeries>[\s\S]*?<\/TimeSeries>/g) || [];

    for (const ts of timeSeriesMatches) {
      const fuelMatch = ts.match(/<MktPSRType>[\s\S]*?<psrType>(.*?)<\/psrType>/);
      const fuel = fuelMatch ? fuelMatch[1] : 'Unknown';
      const pointMatches = ts.match(/<Point>[\s\S]*?<\/Point>/g) || [];

      for (const pt of pointMatches.slice(-1)) { // Last point = most recent
        const qty = pt.match(/<quantity>(.*?)<\/quantity>/);
        if (qty) {
          entries.push({
            fuel_type: mapFuelCode(fuel),
            generation_mw: parseFloat(qty[1]),
            country_code: country,
          });
        }
      }
    }

    return NextResponse.json({
      count: entries.length,
      timestamp: new Date().toISOString(),
      data: entries,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function mapFuelCode(code: string): string {
  const map: Record<string, string> = {
    B01: 'Biomass', B02: 'Fossil Brown coal', B03: 'Fossil Coal-derived gas',
    B04: 'Fossil Gas', B05: 'Fossil Hard coal', B06: 'Fossil Oil',
    B09: 'Geothermal', B10: 'Hydro Pumped Storage', B11: 'Hydro Run-of-river',
    B12: 'Hydro Water Reservoir', B14: 'Nuclear', B15: 'Other renewable',
    B16: 'Solar', B17: 'Waste', B18: 'Wind Offshore', B19: 'Wind Onshore',
    B20: 'Other',
  };
  return map[code] || code;
}
