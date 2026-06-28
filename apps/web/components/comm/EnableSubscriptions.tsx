'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

// COMM E2b — creator action to deploy the space's Unlock lock on Base.
// The deploy is a few on-chain txns (~30s), so the button shows progress.

export function EnableSubscriptions({ spaceId, label }: { spaceId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function enable() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/comm/spaces/${spaceId}/enable`, { method: 'POST' });
      if (res.ok) {
        router.refresh();
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        setErr(
          j.error === 'in_progress'
            ? 'Setup is already running — refresh in a few seconds.'
            : j.detail || j.error || 'Could not enable subscriptions.',
        );
      }
    } catch {
      setErr('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={() => void enable()} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Working on Base… (~30s)' : (label ?? 'Enable subscriptions')}
      </button>
      {err && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 6 }}>{err}</div>}
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
  padding: '9px 16px',
  cursor: 'pointer',
};
