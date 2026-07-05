'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ClaimButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/comm/creator-pro/claim', { method: 'POST' });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      if (j?.claimed !== true) throw new Error('All founding slots are taken.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Claim failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={claim}
        disabled={busy}
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 13,
          letterSpacing: '0.04em',
          padding: '10px 18px',
          borderRadius: 8,
          cursor: busy ? 'wait' : 'pointer',
          border: '1px solid var(--teal)',
          background: 'var(--teal-deep)',
          color: 'var(--ink)',
        }}
      >
        {busy ? 'Claiming…' : 'Claim your founding slot — free for life'}
      </button>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--amber)' }}>{error}</div>}
    </div>
  );
}
