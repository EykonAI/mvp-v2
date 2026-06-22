import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import {
  issueChokepointWeekly,
  type IssueChokepointWeeklyResult,
} from '@/lib/predictions/issue-chokepoint-weekly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Chokepoint AIS prediction issuer · Mondays 09:00 UTC.
 *
 * Inserts one fresh predictions_register row per COVERED chokepoint
 * (source='ais') for the upcoming Sunday 23:59 UTC. Issuing across every
 * strait with a live AIS baseline — not just Malacca — gives the Calibration
 * Ledger enough resolved volume to graduate past the warming-up floor.
 * Idempotent per (slug, week): re-runs return skipped_reason='already_issued'.
 *
 * A slug with no fresh trailing baseline self-skips with
 * skipped_reason='insufficient_baseline' (e.g. the first ~14 days after a
 * strait's snapshot coverage comes online), so listing it here is safe.
 *
 * Recommended Railway schedule: `0 9 * * 1` (Mondays 09:00 UTC).
 * Auth: Bearer <CRON_SECRET>.
 */
// The world's major maritime chokepoints. The issuer self-skips any without a
// fresh trailing AIS baseline, so a slug can be listed before its snapshot
// coverage warms up. As of 2026-06 the snapshot pipeline covers malacca, suez
// and bosphorus; the rest issue automatically once their coverage lands.
const CHOKEPOINT_SLUGS = ['malacca', 'suez', 'bosphorus', 'hormuz', 'bab-el-mandeb', 'panama'];

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const results: Array<IssueChokepointWeeklyResult & { slug: string }> = [];
  for (const slug of CHOKEPOINT_SLUGS) {
    results.push({ slug, ...(await issueChokepointWeekly({ slug })) });
  }

  // A strait lacking a baseline (insufficient_baseline) is expected, not a
  // failure — report counts and always 200 so one cold strait can't fail the run.
  const issued = results.filter((r) => r.ok && !r.skipped_reason).length;
  const already = results.filter((r) => r.skipped_reason === 'already_issued').length;
  const skipped = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: true, issued, already, skipped, results });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
