import { NextRequest, NextResponse } from 'next/server';

// Deliberately throws a server-side error so we can confirm the Sentry server
// SDK (instrumentation.ts -> sentry.server.config.ts) captures and delivers it.
//
// Gated by a dedicated, low-value token (SENTRY_DEBUG_TOKEN) passed as a query
// param so the route is reachable from a plain browser link:
//   /api/debug/sentry?token=<SENTRY_DEBUG_TOKEN>
//
// We intentionally do NOT reuse CRON_SECRET here: query strings leak into server
// logs, browser history, and referrers, and CRON_SECRET guards every cron route.
// A missing/wrong token returns 404 so the route is invisible to probes.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token');
  const expected = process.env.SENTRY_DEBUG_TOKEN;

  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Intentional unhandled error — captured by the Sentry server SDK.
  throw new Error('eYKON Sentry server-capture test (debug route)');
}
