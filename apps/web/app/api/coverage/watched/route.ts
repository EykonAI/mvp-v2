import { NextResponse } from 'next/server';
import { loadWatchedCoverage } from '@/lib/marketing/watched-coverage';

export const dynamic = 'force-dynamic';
// force-dynamic alone does not stop Next 14 caching the supabase GETs in the
// Data Cache (PR #339); a watched count frozen at deploy time is the literal
// this route exists to replace.
export const fetchCache = 'force-no-store';

/**
 * GET /api/coverage/watched — public, read-only aggregates.
 *
 * The homepage is a static client page, so its "refineries watched" stat and
 * the night-lights figure on the Kuwait use case read the named query
 * (lib/marketing/watched-coverage.ts) through here — the same query /start,
 * /mcp and /llms.txt call directly. Counts only, no rows, so it is safe
 * unauthenticated. Edge-cached for five minutes: the figures move nightly,
 * not per request.
 */
export async function GET() {
  const coverage = await loadWatchedCoverage();
  return NextResponse.json(coverage, {
    headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
  });
}
