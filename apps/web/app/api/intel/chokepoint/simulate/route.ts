import { NextRequest, NextResponse } from 'next/server';
import { simulateChokepoint, type ChokepointInput, type ClosureType } from '@/lib/intel/chokepoint';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

function validate(body: any): ChokepointInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object' };
  const allowedClosures: ClosureType[] = ['partial_50', 'full', 'transit_tax_30'];
  if (!body.chokepoint || typeof body.chokepoint !== 'string') return { error: 'chokepoint required' };
  if (!allowedClosures.includes(body.closure_type)) return { error: 'closure_type must be partial_50|full|transit_tax_30' };
  const duration_days = Number(body.duration_days);
  if (!Number.isFinite(duration_days) || duration_days < 1 || duration_days > 90) {
    return { error: 'duration_days must be 1..90' };
  }
  const diversion_lag_hours = Number(body.diversion_lag_hours ?? 48);
  if (!Number.isFinite(diversion_lag_hours) || diversion_lag_hours < 12 || diversion_lag_hours > 96) {
    return { error: 'diversion_lag_hours must be 12..96' };
  }
  return {
    chokepoint: body.chokepoint,
    closure_type: body.closure_type,
    duration_days,
    diversion_lag_hours,
    assumptions: body.assumptions ?? {},
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = validate(body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const output = simulateChokepoint(parsed);

    // Persist as a scenario_run (best-effort — won't fail the request)
    try {
      const supabase = createServerSupabase();
      await supabase.from('scenario_runs').insert({
        scenario_type: 'chokepoint',
        input: parsed,
        output,
      });
    } catch {}

    return NextResponse.json(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
