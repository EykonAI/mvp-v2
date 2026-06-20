import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { canCreateSpace, createSpace } from '@/lib/comm/spaces';

// Create a paid space (COMM E1). Reputation-gated (canCreateSpace); no
// money moves here — checkout is E2. Discovery/detail read via the lib in
// server components, so only POST lives here.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRICE_MIN = 0;
const PRICE_MAX = 10000;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createServerSupabase();
  const gate = await canCreateSpace(supabase, user);
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  let body: { title?: unknown; price_usdc?: unknown; cadence?: unknown; blurb?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const price = typeof body.price_usdc === 'number' ? body.price_usdc : Number(body.price_usdc);
  const cadence = body.cadence === 'annual' ? 'annual' : 'monthly';
  const blurb = typeof body.blurb === 'string' ? body.blurb : undefined;
  if (!title || !Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const id = await createSpace(supabase, user.id, { title, priceUsdc: price, cadence, blurb });
  if (!id) return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}
