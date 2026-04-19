import { NextRequest, NextResponse } from 'next/server';
import { runWargame, type SanctionsInput } from '@/lib/intel/sanctions';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

function validate(body: any): SanctionsInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object' };
  const bodies = Array.isArray(body.sanctioning_bodies) ? body.sanctioning_bodies : [];
  const allowedBodies = ['OFAC', 'EU', 'UK_OFSI', 'UN', 'G7_PRICE_CAP'];
  if (bodies.length === 0 || !bodies.every((b: string) => allowedBodies.includes(b))) {
    return { error: 'sanctioning_bodies must be a non-empty subset of ' + allowedBodies.join('/') };
  }
  const allowedPresets = ['sdn_new_listing', 'secondary_expansion', 'price_cap_tightening', 'maritime_insurance_ban', 'port_of_call_restriction'];
  if (!allowedPresets.includes(body.preset)) return { error: 'preset invalid' };

  const targets = Array.isArray(body.target_entities) ? body.target_entities.filter(Boolean) : [];
  if (targets.length === 0) return { error: 'target_entities required' };

  const depth = Number(body.depth ?? 2);
  if (![1, 2, 3].includes(depth)) return { error: 'depth must be 1|2|3' };

  return {
    sanctioning_bodies: bodies,
    preset: body.preset,
    target_entities: targets,
    depth: depth as 1 | 2 | 3,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = validate(body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const output = runWargame(parsed);

    try {
      const supabase = createServerSupabase();
      await supabase.from('scenario_runs').insert({
        scenario_type: 'sanctions',
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
