import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser } from '@/lib/auth/session';

// COMM E2 — issue a one-time nonce for wallet linking (sign-in-with-ethereum).
// The nonce is stored in an httpOnly cookie; the client signs the returned
// message and /wallet/link verifies the signature carries this nonce.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const nonce = randomUUID();
  const message = `eYKON — link this wallet to your account.\n\nNonce: ${nonce}`;
  const res = NextResponse.json({ message });
  res.cookies.set('comm_wallet_nonce', nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 300,
    path: '/',
  });
  return res;
}
