import { NextRequest, NextResponse } from 'next/server';
import { buildLivePayload } from '@/lib/intel/commodities/live';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/**
 * Commodities workspace — live inputs. Thin wrapper over
 * lib/intel/commodities/live.ts (see that module for methodology:
 * coverage-aware corridors, NO DATA semantics, Cushing series pin).
 */
export async function GET(_req: NextRequest) {
  const payload = await buildLivePayload();
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
