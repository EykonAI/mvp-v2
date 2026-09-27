import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getCurrentTier } from '@/lib/subscription';
import { createServerSupabase } from '@/lib/supabase-server';
import { parseOrderBody } from '@/lib/imagery/orders';

export const dynamic = 'force-dynamic';

/**
 * On-demand VHR look (Imagery IMG-11, mig 194). POST requests one look;
 * GET lists the caller's own requests. Every gate is in the database
 * (imagery_order_request, fail-closed): nothing can be ordered until the
 * founder has bought one look end to end AND set the monthly caps; then
 * Desk / Enterprise only, at the provider's list price, under the account
 * and all-accounts caps. A refusal is answered 409 with its reason — and is
 * itself a recorded row.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const parsed = parseOrderBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const tier = await getCurrentTier();
  const i = parsed.input;
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc('imagery_order_request', {
    p_user: user.id, p_tier: tier, p_provider: i.provider, p_product: i.product,
    p_resolution_m: i.resolution_m, p_looks: i.looks, p_lat: i.lat, p_lon: i.lon, p_note: i.note,
  });
  if (error) return NextResponse.json({ error: `imagery_order_request: ${error.message}` }, { status: 502 });
  const row = (data as Array<{ order_id: number; status: string; price_usd: number | null; eula_tier: string | null; reason: string }> | null)?.[0];
  if (!row) return NextResponse.json({ error: 'no answer from imagery_order_request' }, { status: 502 });
  return NextResponse.json(row, { status: row.status === 'requested' ? 201 : 409 });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('imagery_orders')
    .select('id, requested_at, provider_id, product, resolution_m, looks, latitude, longitude, price_usd, eula_tier, status, refusal_reason, asset_path, updated_at')
    .eq('user_id', user.id)
    .order('requested_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ orders: data ?? [], credit_rule: 'A delivered Umbra look is CC BY 4.0: credit "Umbra Space, CC BY 4.0" with any use.' });
}
