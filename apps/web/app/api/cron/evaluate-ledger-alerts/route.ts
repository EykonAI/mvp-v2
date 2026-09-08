import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { evaluateAndRecordLedgerAlerts } from '@/lib/admin/ledger-alerts';

// Hourly (Railway, suggested `23 * * * *` — after the :07 scorer tick has
// written its run row). Evaluates the Calibration Ledger Monitor's rules,
// records transitions in ledger_alert_state / ledger_alert_events (mig 141)
// and posts fired / escalated / re-alerted / cleared to NEWSJACK_ALERT_WEBHOOK.
// The page reads the state; it never writes it.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;
  const supabase = createServerSupabase();
  const report = await evaluateAndRecordLedgerAlerts(supabase);
  // Errors fail the run so Railway shows it red; a silent evaluator is the
  // exact failure this exists to prevent.
  return NextResponse.json({ ok: report.errors.length === 0, ...report }, { status: report.errors.length ? 500 : 200 });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
