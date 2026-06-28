import { NextRequest, NextResponse } from 'next/server';
import type { Address } from 'viem';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { loadSpace, setSpaceLock, spacesCheckoutEnabled, claimSpaceLockWork, setLockStatus } from '@/lib/comm/spaces';
import { getLinkedWallet } from '@/lib/comm/wallets';
import { createSpaceLock, configureSpaceLock, unlockConfigured } from '@/lib/comm/unlock';

// COMM E2b — "Enable subscriptions": deploy the space's Unlock lock on Base
// (creator = sole manager/beneficiary, platform = 15% referrer). Creator-only,
// flag-gated, resume-safe, and guarded by a one-at-a-time DB claim
// (claimSpaceLockWork, mig 065) so concurrent / double-click requests across
// replicas can't race the deployer nonce. A few on-chain txns → longer maxDuration.

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
  if (space.lock_status === 'ready') return NextResponse.json({ ok: true, lockAddress: space.lock_address });

  const wallet = await getLinkedWallet(supabase, user.id);
  if (!wallet) return NextResponse.json({ error: 'no_wallet' }, { status: 400 });

  // Cross-replica guard: exactly one request may deploy/configure at a time.
  // This (not the in-process serializer) is what stops a double-click from
  // racing the deployer nonce ("replacement transaction underpriced").
  const claim = await claimSpaceLockWork(supabase, params.id);
  if (!claim.ok) {
    return claim.reason === 'ready'
      ? NextResponse.json({ ok: true, lockAddress: space.lock_address })
      : NextResponse.json({ ok: false, error: 'in_progress' }, { status: 409 });
  }

  try {
    // Resume-safe: deploy only if not already deployed, and persist the address
    // BEFORE config so a partial failure resumes instead of redeploying.
    let lockAddress = space.lock_address as string | null;
    if (!lockAddress) {
      lockAddress = await createSpaceLock({
        priceUsdc: space.price_usdc,
        cadence: space.cadence === 'annual' ? 'annual' : 'monthly',
        name: space.title ?? 'eYKON space',
      });
      await setSpaceLock(supabase, params.id, lockAddress, 'base');
    }
    await configureSpaceLock(lockAddress as Address, wallet.address as Address);
    await setLockStatus(supabase, params.id, 'ready');
    return NextResponse.json({ ok: true, lockAddress });
  } catch (err) {
    // Release the claim → 'failed' is reclaimable, so a retry resumes the
    // idempotent config from where it stopped (never redeploys an existing lock).
    await setLockStatus(supabase, params.id, 'failed');
    return NextResponse.json({ ok: false, error: 'setup_failed', detail: (err as Error).message }, { status: 500 });
  }
}
