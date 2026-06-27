import { NextRequest, NextResponse } from 'next/server';
import type { Address } from 'viem';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { loadSpace, grantSubscription, spacesCheckoutEnabled } from '@/lib/comm/spaces';
import { getLinkedWallet } from '@/lib/comm/wallets';
import { hasValidKey } from '@/lib/comm/unlock';

// COMM E2b — verify a subscription on-chain (detection mode 5b). After the
// subscriber buys an Unlock key via the checkout, this reads the lock's
// getHasValidKey for their linked wallet; if valid, it grants the
// subscription + room membership. No webhook — the chain is the source of
// truth. Idempotent (grantSubscription upserts).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY_S = 86400;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!spacesCheckoutEnabled()) return NextResponse.json({ error: 'disabled' }, { status: 403 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createServerSupabase();
  const space = await loadSpace(supabase, params.id, user.id);
  if (!space) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (space.is_member) return NextResponse.json({ ok: true, access: true }); // already has access
  if (!space.lock_address) return NextResponse.json({ error: 'no_lock' }, { status: 400 });

  const wallet = await getLinkedWallet(supabase, user.id);
  if (!wallet) return NextResponse.json({ error: 'no_wallet' }, { status: 400 });

  const valid = await hasValidKey(space.lock_address as Address, wallet.address as Address);
  if (!valid) return NextResponse.json({ ok: true, access: false });

  const secs = (space.cadence === 'annual' ? 365 : 30) * DAY_S;
  await grantSubscription(supabase, params.id, user.id, {
    providerRef: space.lock_address,
    amountUsdc: space.price_usdc,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + secs * 1000).toISOString(),
  });
  return NextResponse.json({ ok: true, access: true });
}
