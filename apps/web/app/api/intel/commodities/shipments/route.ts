import { NextRequest, NextResponse } from 'next/server';
import { buildShipmentsPayload } from '@/lib/intel/commodities/shipments';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/**
 * Commodity shipments (panel 07) — thin wrapper over
 * lib/intel/commodities/shipments.ts. See that module for the
 * paid-tier design + free-tier degradation semantics.
 */
export async function GET(req: NextRequest) {
  const commodity = req.nextUrl.searchParams.get('commodity') ?? '';
  const payload = await buildShipmentsPayload(commodity);
  if (!payload) {
    return NextResponse.json({ error: `unknown commodity '${commodity}'` }, { status: 400 });
  }
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
