import { NextRequest, NextResponse } from 'next/server';
import { propagateCascade, type CascadeInput } from '@/lib/intel/cascade';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

function validate(body: any): CascadeInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object' };
  const seed = Array.isArray(body.seed_nodes) ? body.seed_nodes : [];
  if (seed.length === 0) return { error: 'seed_nodes required' };
  const cap = Number(body.capacity_loss_pct ?? 65);
  if (!Number.isFinite(cap) || cap < 0 || cap > 100) return { error: 'capacity_loss_pct must be 0..100' };
  const dur = Number(body.outage_duration_hours ?? 72);
  if (!Number.isFinite(dur) || dur < 6 || dur > 168) return { error: 'outage_duration_hours must be 6..168' };
  return { seed_nodes: seed, capacity_loss_pct: cap, outage_duration_hours: dur };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = validate(body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const output = propagateCascade(parsed);

    try {
      const supabase = createServerSupabase();
      await supabase.from('scenario_runs').insert({
        scenario_type: 'cascade',
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
