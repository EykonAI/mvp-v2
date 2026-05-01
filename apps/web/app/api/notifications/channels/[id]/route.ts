import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';

// /api/notifications/channels/[id]
//
//   PATCH  → toggle active / rename label.
//   DELETE → remove the channel row. Rules referencing it via
//            channel_ids array element drop the dispatch silently
//            on next fire (the dispatcher resolves the array against
//            the verified-and-active filter).
//
// RLS limits both verbs to the channel owner.

export const dynamic = 'force-dynamic';

interface PatchBody {
  active?: boolean;
  label?: string | null;
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (typeof body.active === 'boolean') updates.active = body.active;
  if (body.label !== undefined) updates.label = body.label?.trim() || null;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_updates' }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('user_channels')
    .update(updates)
    .eq('id', ctx.params.id)
    .select('id, channel_type, handle, label, verified_at, active, created_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'update_failed' }, { status: 404 });
  }
  return NextResponse.json({ channel: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = getServerSupabase();
  const { error } = await supabase.from('user_channels').delete().eq('id', ctx.params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
