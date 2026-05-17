import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { issueEiaWeekly } from '@/lib/predictions/issue-eia-weekly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * EIA weekly prediction issuer · Mondays 09:00 UTC.
 *
 * Inserts a single fresh predictions_register row tagged source='eia'
 * with resolves_at = the upcoming Wednesday's 15:30 UTC EIA Weekly
 * Petroleum Status Report publication time. Idempotent — re-runs in
 * the same Monday→Wednesday window return ok with
 * skipped_reason='already_issued'.
 *
 * Recommended Railway schedule: `0 9 * * 1` (Mondays 09:00 UTC).
 * Auth: Bearer <CRON_SECRET>.
 */
async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const result = await issueEiaWeekly();
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
