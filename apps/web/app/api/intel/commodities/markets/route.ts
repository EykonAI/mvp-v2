import { NextRequest, NextResponse } from 'next/server';
import { buildMarketsPayload } from '@/lib/intel/commodities/markets';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/**
 * Commodities workspace — per-commodity market inputs.
 *
 * Thin wrapper: the entire computation lives in
 * lib/intel/commodities/markets.ts (PR 2, Grounding Brief 2026-08-09
 * rev. B) so the export snapshot and the compliance review reuse the
 * exact numbers the panels render. See that module for the full
 * methodology notes (both-paths export shares, measured OFAC trend,
 * EIA futures + realized volatility, ribbon degradation disclosure).
 */
export async function GET(req: NextRequest) {
  const commodity = req.nextUrl.searchParams.get('commodity') ?? '';
  const payload = await buildMarketsPayload(commodity);
  if (!payload) {
    return NextResponse.json(
      { error: `unknown commodity '${commodity}'` },
      { status: 400 },
    );
  }
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
