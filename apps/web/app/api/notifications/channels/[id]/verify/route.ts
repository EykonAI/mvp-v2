import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';

// POST /api/notifications/channels/[id]/verify
// Body: { code: string }
//
// On match within the expiry window:
//   • verified_at = NOW()
//   • verification_code / verification_expires_at = NULL
//
// On mismatch or expiry: 400 with a discriminated error so the UI
// can display the right hint. The DB-side TTL means stale codes
// can't be reused after the window even if the row sat untouched.

export const dynamic = 'force-dynamic';

interface VerifyBody {
  code?: string;
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as VerifyBody | null;
  const submitted = (body?.code ?? '').trim();
  if (!/^\d{6}$/.test(submitted)) {
    return NextResponse.json({ error: 'invalid_code_format' }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data: channel, error: readError } = await supabase
    .from('user_channels')
    .select('id, verified_at, verification_code, verification_expires_at')
    .eq('id', ctx.params.id)
    .single();

  if (readError || !channel) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (channel.verified_at) {
    return NextResponse.json({ error: 'already_verified' }, { status: 409 });
  }
  if (!channel.verification_code) {
    return NextResponse.json({ error: 'no_pending_code' }, { status: 400 });
  }
  if (channel.verification_expires_at && new Date(channel.verification_expires_at) < new Date()) {
    return NextResponse.json({ error: 'code_expired' }, { status: 400 });
  }
  if (channel.verification_code !== submitted) {
    return NextResponse.json({ error: 'code_mismatch' }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from('user_channels')
    .update({
      verified_at: new Date().toISOString(),
      verification_code: null,
      verification_expires_at: null,
    })
    .eq('id', ctx.params.id)
    .select('id, channel_type, handle, label, verified_at, active, created_at')
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ channel: updated });
}
