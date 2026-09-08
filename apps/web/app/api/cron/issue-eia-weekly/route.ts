import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { issueEiaWeekly } from '@/lib/predictions/issue-eia-weekly';
import { createServerSupabase } from '@/lib/supabase-server';
import { recordIssuanceRun } from '@/lib/predictions/run-records';

// Outcomes that are the issuer declining, not failing: the record counts
// them under `declined`; anything else the issuer reports as not-ok is an
// error the admin monitor must show.
const BENIGN = new Set(['already_issued', 'no_baseline_observation']);

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

  // Run record (mig 138): a row iff this tick ran. Weekly issuers were the
  // two the monitor could not see; a Monday that never fires now shows as a
  // stale record rather than as nothing.
  const reason = result.skipped_reason ?? null;
  await recordIssuanceRun(createServerSupabase(), {
    source: 'eia',
    issued: result.ok && !reason ? 1 : 0,
    already_present: reason === 'already_issued' ? 1 : 0,
    declined: reason && reason !== 'already_issued' && BENIGN.has(reason) ? { [reason]: 1 } : {},
    error: !result.ok && reason && !BENIGN.has(reason) ? reason : null,
  });

  return NextResponse.json(result, { status });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
