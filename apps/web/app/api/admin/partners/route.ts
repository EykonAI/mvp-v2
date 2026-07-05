import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { grantFoundingPartner } from '@/lib/comm/foundingPartner';

// POST /api/admin/partners — grant a Founding Partner slot.
// Body: { lookup: '@handle' | 'email@x', vetting_note?: string }
// Founder-gated. The lookup resolves to a user_profiles row; the grant
// enforces the 20-cap and the shared Creator-Pro free-50 pool.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isFounder(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { lookup?: string; vetting_note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const lookup = (body.lookup ?? '').trim();
  if (!lookup) return NextResponse.json({ error: 'lookup required' }, { status: 400 });

  const admin = createServerSupabase();
  let target: { id: string } | null = null;
  if (lookup.includes('@') && lookup.includes('.') && !lookup.startsWith('@')) {
    const { data } = await admin
      .from('user_profiles')
      .select('id')
      .ilike('email', lookup)
      .maybeSingle();
    target = data as { id: string } | null;
  } else {
    const handle = lookup.replace(/^@/, '');
    const { data } = await admin
      .from('user_profiles')
      .select('id')
      .eq('handle', handle)
      .maybeSingle();
    target = data as { id: string } | null;
  }
  if (!target) return NextResponse.json({ error: `No user found for "${lookup}"` }, { status: 404 });

  const result = await grantFoundingPartner(admin, target.id, {
    vettingNote: body.vetting_note,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true, already: result.already });
}
