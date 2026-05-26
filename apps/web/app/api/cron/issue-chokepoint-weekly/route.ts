import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { issueChokepointWeekly } from '@/lib/predictions/issue-chokepoint-weekly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Chokepoint AIS prediction issuer · Mondays 09:00 UTC.
 *
 * Inserts a single fresh predictions_register row tagged source='ais'
 * for the upcoming Sunday 23:59 UTC. Idempotent — re-runs in the same
 * Monday→Sunday window return ok with skipped_reason='already_issued'.
 *
 * Returns skipped_reason='insufficient_baseline' for the first ~14
 * days after deploy, until the snapshot cron has accumulated enough
 * observations to compute a trailing-4-week baseline.
 *
 * Recommended Railway schedule: `0 9 * * 1` (Mondays 09:00 UTC).
 * Auth: Bearer <CRON_SECRET>.
 */
async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const result = await issueChokepointWeekly();
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
