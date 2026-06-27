import { NextRequest, NextResponse } from 'next/server';
import type { Address } from 'viem';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { loadSpace, setSpaceLock, spacesCheckoutEnabled } from '@/lib/comm/spaces';
import { getLinkedWallet } from '@/lib/comm/wallets';
import { deploySpaceLock, unlockConfigured } from '@/lib/comm/unlock';

// COMM E2b — "Enable subscriptions": deploy the space's Unlock lock on Base
// (creator = sole manager/beneficiary, platform = 15% referrer). Creator-only,
// flag-gated, idempotent (no-op if a lock already exists). The deploy is a
// few on-chain txns, hence the longer maxDuration.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!spacesCheckoutEnabled()) return NextResponse.json({ error: 'disabled' }, { status: 403 });
  if (!unlockConfigured()) return NextResponse.json({ error: 'unlock_not_configured' }, { status: 503 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createServerSupabase();
  const space = await loadSpace(supabase, params.id, user.id);
  if (!space) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!space.is_creator) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (space.lock_address) return NextResponse.json({ ok: true, lockAddress: space.lock_address });

  const wallet = await getLinkedWallet(supabase, user.id);
  if (!wallet) return NextResponse.json({ error: 'no_wallet' }, { status: 400 });

  let lockAddress: string;
  try {
    lockAddress = await deploySpaceLock({
      creator: wallet.address as Address,
      priceUsdc: space.price_usdc,
      cadence: space.cadence === 'annual' ? 'annual' : 'monthly',
      name: space.title ?? 'eYKON space',
    });
  } catch (err) {
    return NextResponse.json({ error: 'deploy_failed', detail: (err as Error).message }, { status: 500 });
  }

  await setSpaceLock(supabase, params.id, lockAddress, 'base');
  return NextResponse.json({ ok: true, lockAddress });
}
