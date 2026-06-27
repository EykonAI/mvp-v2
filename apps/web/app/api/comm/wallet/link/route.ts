import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth/session';
import { upsertWallet } from '@/lib/comm/wallets';

// COMM E2 — link a wallet via a signed nonce. Verifies the signature was
// produced by `address` over a message carrying the server-issued nonce
// (cookie), then records the verified wallet for the user.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const nonce = req.cookies.get('comm_wallet_nonce')?.value;
  if (!nonce) return NextResponse.json({ error: 'no_nonce' }, { status: 400 });

  let body: { address?: unknown; signature?: unknown; message?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  const message = typeof body.message === 'string' ? body.message : '';
  if (!ADDRESS_RE.test(address) || !signature || !message || !message.includes(nonce)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const ok = await verifyMessage({
    address: address as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!ok) return NextResponse.json({ error: 'bad_signature' }, { status: 400 });

  const supabase = createServerSupabase();
  const saved = await upsertWallet(supabase, user.id, address, 'base', true);
  if (!saved) return NextResponse.json({ error: 'save_failed' }, { status: 500 });

  const res = NextResponse.json({ ok: true, address });
  res.cookies.delete('comm_wallet_nonce');
  return res;
}
