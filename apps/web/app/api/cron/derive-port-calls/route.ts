import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// derive-port-calls · READ-ONLY coverage report. It derives nothing and
// prunes nothing.
//
// Until migration 162 this route called derive_port_calls(p_since) over
// PostgREST, where the `authenticator` role's 8 s statement_timeout
// cancelled it (SQLSTATE 57014) every night after the 2026-08-24 AIS step:
// port_calls wrote nothing after 2026-09-11 01:46 UTC, and the 90-day
// prune that ran after the RPC never ran at all. Heavy SQL does not belong
// behind an HTTP call with an 8 s ceiling (the mig-122 lesson).
//
// Where the work lives now, on pg_cron (120 s database timeout):
//   · derive-port-calls   00:17 + 12:17 UTC → derive_port_calls_due(3)
//                          one UTC day at a time, a run record per day (mig 162)
//   · prune-ais-history   hourly at :44 → prune_ais_position_history(14, 1, 7)
//                          only days already derived (mig 163)
//
// What this route does: reads the port_call_coverage view (mig 163) for the
// last 21 completed UTC days and says whether every one was derived. It
// returns 503 while any day in that window is missing or failed, so a
// forgotten caller (the Railway cron service, until it is paused) reports
// a stale derivation loudly instead of pretending to run it.
//
// Auth: Bearer <CRON_SECRET>. GET and POST behave the same.

const WINDOW_DAYS = 21;

type CoverageDay = {
  day: string;
  status: 'derived' | 'samples_absent' | 'failed' | 'missing' | 'pending';
  partial: boolean;
  live_hours: number | null;
  vessel_days: number | null;
  ran_at: string | null;
  error: string | null;
};

type WindowCoverage = {
  first_day: string;
  last_day: string;
  days_total: number;
  days_derived: number;
  days_partial: number;
  days_samples_absent: number;
  days_failed: number;
  days_missing: number;
  days_pending: number;
  complete: boolean;
  label: string;
};

async function report(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();

  const [{ data: cov, error: covErr }, { data: days, error: daysErr }] = await Promise.all([
    supabase.rpc('port_call_window_coverage', { p_days: WINDOW_DAYS }),
    supabase
      .from('port_call_coverage')
      .select('day, status, partial, live_hours, vessel_days, ran_at, error')
      .order('day', { ascending: false })
      .limit(WINDOW_DAYS + 1),
  ]);

  if (covErr || daysErr) {
    return NextResponse.json(
      {
        ok: false,
        error: covErr?.message ?? daysErr?.message,
        note: 'port_call_coverage unreadable — has migration 163 been applied?',
      },
      { status: 500 },
    );
  }

  const windowCoverage = ((cov ?? []) as WindowCoverage[])[0] ?? null;
  const recent = (days ?? []) as CoverageDay[];
  const stale = recent.filter((d) => d.status === 'missing' || d.status === 'failed');
  const healthy = stale.length === 0;

  return NextResponse.json(
    {
      ok: healthy,
      mode: 'read-only',
      derivation: 'pg_cron job derive-port-calls (17 0,12 * * *) → derive_port_calls_due(3), migration 162',
      retention: 'pg_cron job prune-ais-history (44 * * * *) → prune_ais_position_history(14, 1, 7), migration 163',
      coverage: windowCoverage,
      stale_days: stale.map((d) => ({ day: d.day, status: d.status, error: d.error })),
      recent,
    },
    { status: healthy ? 200 : 503 },
  );
}

export async function GET(req: NextRequest) {
  return report(req);
}

export async function POST(req: NextRequest) {
  return report(req);
}
