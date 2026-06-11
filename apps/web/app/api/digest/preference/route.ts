import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';

// Signed-in digest preference (the Settings card). The email's
// unsubscribe link is the token route; this is the in-app equivalent,
// letting a user opt back IN as well as out.
//
//   GET  → { opted_out, frequency }
//   POST { opted_out: boolean } → merge into notification_preferences

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('notification_preferences')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const prefs = (data?.notification_preferences as Record<string, unknown> | null) ?? {};
  return NextResponse.json({
    opted_out: prefs.digest_opted_out === true,
    frequency: prefs.digest_frequency === 'weekly' ? 'weekly' : 'daily',
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { opted_out?: unknown };
  try {
    body = (await req.json()) as { opted_out?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.opted_out !== 'boolean') {
    return NextResponse.json({ error: 'opted_out must be boolean' }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('notification_preferences')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const prefs = (data?.notification_preferences as Record<string, unknown> | null) ?? {};
  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({
      notification_preferences: { ...prefs, digest_opted_out: body.opted_out },
    })
    .eq('id', user.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, opted_out: body.opted_out });
}
