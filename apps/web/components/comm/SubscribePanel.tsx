'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { ConnectWallet } from '@/components/comm/ConnectWallet';

// COMM E2b — subscriber checkout. Sends the buyer to the hosted Unlock
// checkout for this space's lock (non-custodial USDC on Base), then verifies
// key ownership on-chain (/verify) to grant access. The buyer must pay from
// the wallet they linked, so we can map the key → their account.

export function SubscribePanel({
  spaceId,
  lock,
  network,
  referrer,
  priceLabel,
  linkedWallet,
}: {
  spaceId: string;
  lock: string;
  network: number;
  referrer: string;
  priceLabel: string;
  linkedWallet: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const verify = useCallback(async () => {
    setBusy(true);
    setMsg('Confirming your subscription on-chain…');
    try {
      const res = await fetch(`/api/comm/spaces/${spaceId}/verify`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { access?: boolean; error?: string };
      if (res.ok && j.access) {
        router.refresh();
        return;
      }
      setMsg(
        j.error === 'no_wallet'
          ? 'Connect the wallet you paid with, then retry.'
          : 'No active key found yet — if you just paid, give it a few seconds and retry.',
      );
    } catch {
      setMsg('Could not verify — try again.');
    } finally {
      setBusy(false);
    }
  }, [spaceId, router]);

  // Returning from the Unlock checkout (?checkout=ok) → auto-verify.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') === 'ok') void verify();
  }, [verify]);

  function subscribe() {
    const redirectUri = `${window.location.origin}/spaces/${spaceId}?checkout=ok`;
    const config = {
      locks: { [lock]: { network } },
      referrer,
      persistentCheckout: false,
      title: 'Subscribe',
    };
    window.location.href =
      `https://app.unlock-protocol.com/checkout?redirectUri=${encodeURIComponent(redirectUri)}` +
      `&paywallConfig=${encodeURIComponent(JSON.stringify(config))}`;
  }

  if (!linkedWallet) {
    return (
      <div>
        <p style={{ color: 'var(--ink-dim)', fontSize: 12.5, margin: '0 0 10px', lineHeight: 1.6 }}>
          Connect the wallet you&rsquo;ll pay from, then subscribe.
        </p>
        <ConnectWallet linked={null} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={subscribe} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
          Subscribe — {priceLabel}
        </button>
        <button onClick={() => void verify()} disabled={busy} style={ghostBtn}>
          I&rsquo;ve paid — unlock
        </button>
      </div>
      {msg && <div style={{ color: 'var(--ink-dim)', fontSize: 11, marginTop: 8 }}>{msg}</div>}
      <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 8, lineHeight: 1.5 }}>
        Non-custodial USDC on Base via Unlock. Pay from your linked wallet ({linkedWallet.slice(0, 6)}…{linkedWallet.slice(-4)}).
      </p>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  border: '1px solid var(--teal-dim)',
  borderRadius: 4,
  padding: '10px 18px',
  cursor: 'pointer',
};
const ghostBtn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10.5,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ink-dim)',
  background: 'transparent',
  border: '1px solid var(--rule)',
  borderRadius: 4,
  padding: '10px 14px',
  cursor: 'pointer',
};
