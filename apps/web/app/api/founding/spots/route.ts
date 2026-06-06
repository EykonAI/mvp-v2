import { NextResponse } from 'next/server';
import { getFoundingSeats } from '@/lib/founding-seats';
import { safeError } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/founding/spots — public, read-only.
 *
 * Powers the landing page "X of 1,000 founding seats remaining" pill so it
 * reflects the real computed number instead of a hard-coded marketing
 * string (decision D-4). Returns ONLY the aggregate — no row data — so it
 * is safe to expose unauthenticated. Cached at the edge for 60s to keep
 * the high-traffic landing page off the DB hot path.
 */
export async function GET() {
  try {
    const seats = await getFoundingSeats();
    return NextResponse.json(
      { cap: seats.cap, spots_left: seats.spotsLeft },
      { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (err) {
    safeError('[founding/spots] count failed', err);
    return NextResponse.json({ error: 'unavailable' }, { status: 500 });
  }
}
