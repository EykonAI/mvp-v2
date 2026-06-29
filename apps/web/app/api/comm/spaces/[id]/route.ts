import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { updateSpace, setSpaceStatus, type ManageResult } from '@/lib/comm/spaces';

// Creator-only management for a paid space (COMM UX Uplift §4.2): edit fields,
// pause/resume, or archive (the honest "delete"). Ownership is enforced in the
// lib; the on-chain Unlock lock is never touched — archive only unlinks it, so
// the creator's funds stay theirs on Base.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRICE_MAX = 10000;

function httpStatusFor(error?: string): number {
  switch (error) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'update_failed':
      return 500;
    default:
      return 400; // invalid_*, archived, price_locked_onchain
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const spaceId = params.id;
  if (!UUID_RE.test(spaceId)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: { action?: unknown; title?: unknown; blurb?: unknown; price_usdc?: unknown; cadence?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const supabase = createServerSupabase();

  let result: ManageResult;
  if (action === 'edit') {
    const patch: { title?: string; blurb?: string | null; priceUsdc?: number; cadence?: 'monthly' | 'annual' } = {};
    if (typeof body.title === 'string') patch.title = body.title;
    if (body.blurb === null || typeof body.blurb === 'string') patch.blurb = body.blurb as string | null;
    if (body.price_usdc != null) {
      const p = Number(body.price_usdc);
      if (!Number.isFinite(p) || p < 0 || p > PRICE_MAX) {
        return NextResponse.json({ error: 'invalid_price' }, { status: 400 });
      }
      patch.priceUsdc = p;
    }
    if (body.cadence === 'monthly' || body.cadence === 'annual') patch.cadence = body.cadence;
    result = await updateSpace(supabase, spaceId, user.id, patch);
  } else if (action === 'pause') {
    result = await setSpaceStatus(supabase, spaceId, user.id, 'paused');
  } else if (action === 'resume') {
    result = await setSpaceStatus(supabase, spaceId, user.id, 'live');
  } else if (action === 'archive') {
    result = await setSpaceStatus(supabase, spaceId, user.id, 'archived');
  } else {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  }

  if (!result.ok) return NextResponse.json({ error: result.error ?? 'failed' }, { status: httpStatusFor(result.error) });
  return NextResponse.json({ ok: true });
}
