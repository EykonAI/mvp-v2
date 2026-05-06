import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getServerSupabase } from '@/lib/auth/session';
import { isShareKind, SHARE_KIND_TABLE, type ShareKind } from '@/lib/share';

// POST /api/share/revoke
// Owner-only. Clears share_token + shared_at on the row, immediately
// breaking the public URL. Subsequent re-shares will mint a fresh
// token (the URL is not stable after revoke + re-share).
//
// Body: { kind: 'analyst' | 'notification', id: <uuid> }
// Response: 204 on success.
//
// Ownership enforced via RLS — the user-scoped UPDATE only touches
// rows the caller owns.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RevokeBody = {
  kind?: string;
  id?: string;
};

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: RevokeBody;
  try {
    body = (await req.json()) as RevokeBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!isShareKind(body.kind) || typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const kind: ShareKind = body.kind;
  const table = SHARE_KIND_TABLE[kind];

  const supabase = getServerSupabase();

  const { error } = await supabase
    .from(table)
    .update({ share_token: null, shared_at: null })
    .eq('id', body.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
