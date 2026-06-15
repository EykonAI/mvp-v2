import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';

// Follow / unfollow. follower_id is always the authenticated user
// (scoped the same way as the other COMM write routes). POST follows,
// DELETE unfollows; the target profile id comes from the JSON body
// (POST) or the ?profileId query (DELETE).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function targetId(req: NextRequest): Promise<string | null> {
  const q = req.nextUrl.searchParams.get('profileId');
  if (q) return q;
  try {
    const b = (await req.json()) as { profileId?: unknown };
    return typeof b.profileId === 'string' ? b.profileId : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const profileId = await targetId(req);
  if (!profileId || !UUID_RE.test(profileId)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  if (profileId === user.id) {
    return NextResponse.json({ error: 'cannot_follow_self' }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('comm_follows')
    .upsert({ follower_id: user.id, followee_id: profileId }, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, following: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const profileId = await targetId(req);
  if (!profileId || !UUID_RE.test(profileId)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('comm_follows')
    .delete()
    .eq('follower_id', user.id)
    .eq('followee_id', profileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, following: false });
}
