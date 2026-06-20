'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

// COMM E1 — reputation-gated "Create a space" form. Rendered only when the
// server has already confirmed the viewer is eligible. POSTs to
// /api/comm/spaces (which re-checks the gate) then routes to the new space.

export function CreateSpace() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [cadence, setCadence] = useState<'monthly' | 'annual'>('monthly');
  const [blurb, setBlurb] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    const t = title.trim();
    const priceNum = Number(price);
    if (!t || !Number.isFinite(priceNum) || priceNum < 0 || busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/comm/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, price_usdc: priceNum, cadence, blurb: blurb.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.ok && j.id) router.push(`/spaces/${j.id}`);
      else setErr(j.error || 'Could not create the space.');
    } catch {
      setErr('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={primaryBtn}>
        + Create a space
      </button>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 10 }}>
        New paid space
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 80))}
        placeholder="Space name (e.g. Maritime Chokepoints Desk)"
        style={input}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))}
          inputMode="decimal"
          placeholder="Price (USDC)"
          style={{ ...input, flex: 1 }}
        />
        <select value={cadence} onChange={(e) => setCadence(e.target.value as 'monthly' | 'annual')} style={{ ...input, width: 130 }}>
          <option value="monthly">/ month</option>
          <option value="annual">/ year</option>
        </select>
      </div>
      <textarea
        value={blurb}
        onChange={(e) => setBlurb(e.target.value.slice(0, 280))}
        placeholder="What subscribers get (optional, 280 chars)"
        rows={2}
        style={{ ...input, marginTop: 8, resize: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button onClick={() => void submit()} disabled={busy || !title.trim() || !price} style={{ ...primaryBtn, opacity: busy || !title.trim() || !price ? 0.5 : 1 }}>
          {busy ? 'Creating…' : 'Create space'}
        </button>
        <button onClick={() => setOpen(false)} style={ghostBtn}>
          Cancel
        </button>
        {err && <span style={{ color: 'var(--red)', fontSize: 11 }}>{err}</span>}
      </div>
      <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.5 }}>
        Subscriptions open soon — non-custodial USDC via Unlock Protocol. For now the space is created and you can post in it.
      </p>
    </div>
  );
}

const card: CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 8,
  padding: 16,
  background: 'var(--bg-panel)',
  marginBottom: 18,
};
const input: CSSProperties = {
  width: '100%',
  background: 'var(--bg-void)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '9px 12px',
  color: 'var(--ink)',
  fontFamily: 'var(--f-body)',
  fontSize: 13.5,
};
const primaryBtn: CSSProperties = {
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
const ghostBtn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ink-dim)',
  background: 'transparent',
  border: '1px solid var(--rule)',
  borderRadius: 4,
  padding: '9px 16px',
  cursor: 'pointer',
};
