import { NextResponse } from 'next/server';
import minerals from '@/lib/fixtures/mineral_supply.json';

export const dynamic = 'force-dynamic';

/** Minerals overview — tonnage, China refining share, supply risk, and illustrative in-transit shipments. */
export async function GET() {
  const in_transit = [
    { vessel: 'DON GIOVANNI',    flag: 'PAN', route: 'DRC → Shanghai',   mineral: 'cobalt',    tonnage_t: 18_400, eta_hours: 310 },
    { vessel: 'BERLIN TIGRIS',   flag: 'BHS', route: 'Australia → Ulsan','mineral': 'lithium',  tonnage_t: 23_000, eta_hours: 192 },
    { vessel: 'GRAN CANARIA',    flag: 'MLT', route: 'Indonesia → Shekou',mineral: 'nickel',   tonnage_t: 32_200, eta_hours: 72  },
    { vessel: 'EVERGLOW SAIL',   flag: 'HKG', route: 'Bayan Obo → Tianjin', mineral: 'neodymium', tonnage_t: 4_100, eta_hours: 24 },
  ];

  return NextResponse.json({
    groups: minerals.groups,
    refining_dominance: minerals.refining_dominance,
    mines: minerals.mines,
    supply_risk_index: minerals.supply_risk_index,
    in_transit,
  });
}
