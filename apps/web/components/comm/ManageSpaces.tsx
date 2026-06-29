'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import type { ManageSpace } from '@/lib/comm/spaces';

// Creator-only Manage tab (COMM UX Uplift §4.2): per-space edit, pause/resume,
// and archive (the honest "delete"). All mutations PATCH /api/comm/spaces/[id]
// (which re-checks ownership) then refresh. The delete confirmation states the
// on-chain reality exactly — the lock is unlinked, not destroyed.

const DELETE_COPY =
  'Subscribers lose access and the room is archived. Your Unlock lock and funds stay yours on Base — there is no on-chain delete; the lock is simply unlinked.';

const ERR_LABELS: Record<string, string> = {
  price_locked_onchain: 'Price is set on-chain once a lock is deployed — change it at the lock on Base.',
  invalid_title: 'Title can’t be empty.',
  invalid_price: 'Enter a valid price.',
  forbidden: 'You don’t own this space.',
  archived: 'This space is already archived.',
  not_found: 'Space not found.',
};
function errLabel(code?: string): string {
  return (code && ERR_LABELS[code]) || 'Something went wrong — try again.';
}

export function ManageSpaces({ spaces }: { spaces: ManageSpace[] }) {
  if (spaces.length === 0) {
    return <div style={empty}>You don’t run any spaces yet. Create one above to get started.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {spaces.map((s) => (
        <ManageRow key={s.id} s={s} />
      ))}
    </div>
  );
}

function ManageRow({ s }: { s: ManageSpace }) {
  const router = useRouter();
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [title, setTitle] = useState(s.title ?? '');
  const [blurb, setBlurb] = useState(s.blurb ?? '');
  const [price, setPrice] = useState(String(s.price_usdc));
  const [cadence, setCadence] = useState<'monthly' | 'annual'>(s.cadence === 'annual' ? 'annual' : 'monthly');
  const priceLocked = !!s.lock_address; // key price is fixed on-chain once deployed

  async function patch(payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/comm/spaces/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setMode('view');
        router.refresh();
      } else {
        setErr(errLabel(j.error));
      }
    } catch {
      setErr('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  const statusTone =
    s.status === 'live' ? 'var(--teal)' : s.status === 'paused' ? 'var(--amber)' : 'var(--ink-dim)';

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ flex: 1, fontFamily: 'var(--f-display)', fontSize: 15, color: 'var(--ink)' }}>
          {s.title ?? 'Untitled space'}
        </span>
        <span style={{ ...chip, color: statusTone, borderColor: statusTone }}>{s.status}</span>
      </div>

      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 6 }}>
        {fmtUsdc(s.price_usdc)} USDC / {s.cadence === 'annual' ? 'yr' : 'mo'} · {s.subscriber_count} subscriber
        {s.subscriber_count === 1 ? '' : 's'} ·{' '}
        {s.lock_address ? (
          <a
            href={`https://basescan.org/address/${s.lock_address}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--teal)', textDecoration: 'none' }}
          >
            lock ◇ {s.lock_address.slice(0, 6)}…{s.lock_address.slice(-4)} ↗
          </a>
        ) : s.lock_status === 'working' ? (
          'lock configuring…'
        ) : (
          'no lock yet'
        )}
      </div>

      {mode === 'edit' && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder="Space name" style={input} />
          <textarea
            value={blurb}
            onChange={(e) => setBlurb(e.target.value.slice(0, 280))}
            placeholder="What subscribers get (optional)"
            rows={2}
            style={{ ...input, resize: 'none' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, '').slice(0, 8))}
              inputMode="decimal"
              placeholder="Price (USDC)"
              disabled={priceLocked}
              style={{ ...input, flex: 1, opacity: priceLocked ? 0.5 : 1 }}
            />
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as 'monthly' | 'annual')}
              disabled={priceLocked}
              style={{ ...input, width: 120, opacity: priceLocked ? 0.5 : 1 }}
            >
              <option value="monthly">/ month</option>
              <option value="annual">/ year</option>
            </select>
          </div>
          {priceLocked && (
            <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
              Price &amp; cadence are fixed on-chain — change them at the lock on Base.
            </span>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() =>
                void patch({
                  action: 'edit',
                  title: title.trim(),
                  blurb: blurb.trim(),
                  ...(priceLocked ? {} : { price_usdc: Number(price), cadence }),
                })
              }
              disabled={busy || !title.trim()}
              style={{ ...primaryBtn, opacity: busy || !title.trim() ? 0.5 : 1 }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setMode('view')} style={ghostBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'confirm' && (
        <div style={{ marginTop: 12, border: '1px solid var(--red)', borderRadius: 6, padding: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--ink-dim)', margin: 0, lineHeight: 1.5 }}>{DELETE_COPY}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <button onClick={() => void patch({ action: 'archive' })} disabled={busy} style={{ ...dangerBtn, opacity: busy ? 0.5 : 1 }}>
              {busy ? 'Deleting…' : 'Delete space'}
            </button>
            <button onClick={() => setMode('view')} style={ghostBtn}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {mode === 'view' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setMode('edit')} style={ghostBtn}>
            Edit
          </button>
          {s.status === 'paused' ? (
            <button onClick={() => void patch({ action: 'resume' })} disabled={busy} style={ghostBtn}>
              Resume
            </button>
          ) : (
            <button onClick={() => void patch({ action: 'pause' })} disabled={busy} style={ghostBtn}>
              Pause
            </button>
          )}
          <button onClick={() => setMode('confirm')} style={{ ...ghostBtn, color: 'var(--red)', borderColor: 'var(--red)' }}>
            Delete
          </button>
        </div>
      )}

      {err && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function fmtUsdc(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const card: CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 8,
  padding: '13px 15px',
  background: 'var(--bg-panel)',
};
const empty: CSSProperties = {
  padding: 24,
  textAlign: 'center',
  border: '1px dashed var(--rule)',
  borderRadius: 8,
  color: 'var(--ink-faint)',
  fontSize: 13,
};
const chip: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 9.5,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  border: '1px solid',
  borderRadius: 999,
  padding: '2px 8px',
  flexShrink: 0,
};
const input: CSSProperties = {
  width: '100%',
  background: 'var(--bg-void)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '8px 11px',
  color: 'var(--ink)',
  fontFamily: 'var(--f-body)',
  fontSize: 13,
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
  padding: '8px 14px',
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
  padding: '8px 14px',
  cursor: 'pointer',
};
const dangerBtn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#FFFFFF',
  background: 'var(--red)',
  border: '1px solid var(--red)',
  borderRadius: 4,
  padding: '8px 14px',
  cursor: 'pointer',
};
