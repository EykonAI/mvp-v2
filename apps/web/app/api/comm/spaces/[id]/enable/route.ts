import { NextRequest, NextResponse } from 'next/server';
import type { Address } from 'viem';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { loadSpace, setSpaceLock, spacesCheckoutEnabled } from '@/lib/comm/spaces';
import { getLinkedWallet } from '@/lib/comm/wallets';
import { createSpaceLock, configureSpaceLock, unlockConfigured } from '@/lib/comm/unlock';

// COMM E2b — "Enable subscriptions": deploy the space's Unlock lock on Base
// (creator = sole manager/beneficiary, platform = 15% referrer). Creator-only,
// flag-gated, and resume-safe: a half-deployed lock (deploy ok, config failed)
// is finished on the next call, never re-deployed. The deploy is a few on-chain
// txns, hence the longer maxDuration.

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
  const wallet = await getLinkedWallet(supabase, user.id);
  if (!wallet) return NextResponse.json({ error: 'no_wallet' }, { status: 400 });

  // Resume-safe: deploy the lock (only if not already deployed) and persist
  // its address BEFORE the config txns, so a partial failure resumes instead
  // of orphaning a lock + redeploying. configureSpaceLock is idempotent.
  let lockAddress = space.lock_address as string | null;
  if (!lockAddress) {
    try {
      lockAddress = await createSpaceLock({
        priceUsdc: space.price_usdc,
        cadence: space.cadence === 'annual' ? 'annual' : 'monthly',
        name: space.title ?? 'eYKON space',
      });
    } catch (err) {
      return NextResponse.json({ error: 'deploy_failed', detail: (err as Error).message }, { status: 500 });
    }
    await setSpaceLock(supabase, params.id, lockAddress, 'base'); // persist immediately, before config
  }

  try {
    await configureSpaceLock(lockAddress as Address, wallet.address as Address);
  } catch (err) {
    // The lock exists and is recorded; the creator can retry enable to finish config.
    return NextResponse.json({ ok: false, lockAddress, error: 'configure_failed', detail: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, lockAddress });
}
