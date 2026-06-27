'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

// COMM E2 — link a wallet via sign-in-with-ethereum. Requests an account
// from the injected wallet (MetaMask / Coinbase / etc.), signs the server
// nonce, and posts the signature to /api/comm/wallet/link.

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
  }
}

export function ConnectWallet({ linked }: { linked?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function connect() {
    setErr('');
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!eth) {
      setErr('No wallet found — install or enable MetaMask (or another Base wallet).');
      return;
    }
    setBusy(true);
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error('no_account');
      const nres = await fetch('/api/comm/wallet/nonce');
      const { message } = (await nres.json()) as { message?: string };
      if (!message) throw new Error('no_nonce');
      const signature = (await eth.request({ method: 'personal_sign', params: [message, address] })) as string;
      const res = await fetch('/api/comm/wallet/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, message }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error === 'bad_signature' ? 'Signature did not verify.' : 'Could not link the wallet.');
      }
    } catch (e) {
      setErr((e as Error).message === 'no_account' ? 'No account selected.' : 'Wallet connection cancelled or failed.');
    } finally {
      setBusy(false);
    }
  }

  if (linked) {
    return (
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--ink-dim)' }}>
        Wallet linked: <span style={{ color: 'var(--teal)' }}>{linked.slice(0, 6)}…{linked.slice(-4)}</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button onClick={() => void connect()} disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
        {busy ? 'Connecting…' : 'Connect wallet'}
      </button>
      {err && <span style={{ color: 'var(--red)', fontSize: 11 }}>{err}</span>}
    </div>
  );
}

const btn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  border: '1px solid var(--teal-dim)',
  borderRadius: 4,
  padding: '8px 14px',
  cursor: 'pointer',
};
