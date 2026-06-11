import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { isValidPersona } from '@/lib/intelligence-analyst/personas';

// Persists the caller's active persona to user_profiles.preferred_persona
// (migration 052) so server-side features — the zero-config digest cron —
// can tailor by persona. Persona was previously client-only (localStorage
// 'eykon.persona'); setActivePersona() calls this fire-and-forget whenever
// the user picks a persona.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { persona?: unknown };
  try {
    body = (await req.json()) as { persona?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!isValidPersona(body.persona)) {
    return NextResponse.json({ error: 'invalid_persona' }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('user_profiles')
    .update({ preferred_persona: body.persona })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, persona: body.persona });
}
