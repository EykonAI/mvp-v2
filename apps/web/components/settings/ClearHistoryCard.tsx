'use client';
import { useEffect, useState } from 'react';

/**
 * GDPR-required (§4.6): per-user destructive action that wipes every
 * row in user_queries belonging to the signed-in user. Two-step UI:
 * a primary button reveals a typed-confirmation input, and only the
 * literal string "DELETE" arms the irreversible action.
 *
 * The DELETE flow is RLS-gated server-side; the typed confirmation
 * is purely a footgun guard for the UI. Once cleared, the row count
 * resets to 0 in-place — no full-page refresh.
 */
export function ClearHistoryCard() {
  const [count, setCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ deleted: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/user_queries', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        // The list endpoint caps at 10; for the settings card we want
        // the *full* count. Use a separate count probe rather than
        // re-paginating from the client.
        setCount((data.entries ?? []).length);
        // Best-effort exact count via a HEAD-style query.
        fetch('/api/user_queries/count', { cache: 'no-store' })
          .then(r => (r.ok ? r.json() : null))
          .then(d => {
            if (cancelled || typeof d?.count !== 'number') return;
            setCount(d.count);
          })
          .catch(() => { /* fall back to the 10-cap estimate */ });
      })
      .catch(() => setCount(null));
    return () => { cancelled = true; };
  }, []);

  const armed = confirmInput.trim() === 'DELETE';

  async function clear() {
    if (!armed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/user_queries/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setResult({ deleted: data.deleted ?? 0 });
      setCount(0);
      setConfirming(false);
      setConfirmInput('');
    } catch (e: any) {
      setError(e?.message ?? 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  const countLabel =
    count == null
      ? 'Loading entry count…'
      : count === 0
      ? 'No queries on record.'
      : `${count} ${count === 1 ? 'entry' : 'entries'} on record.`;

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '24px 28px',
        marginBottom: 24,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          marginBottom: 10,
        }}
      >
        Query history
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink)', margin: '0 0 4px' }}>
        Clear every query stored against your account.
      </p>
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '0 0 16px', lineHeight: 1.5 }}>
        {countLabel} This is irreversible. Personalised suggestions and history-tab entries will reset.
      </p>

      {!confirming && !result && (
        <button
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          disabled={count === 0}
          style={{
            background: 'transparent',
            color: count === 0 ? 'var(--ink-faint)' : 'var(--red)',
            border: '1px solid ' + (count === 0 ? 'var(--rule)' : 'var(--red)'),
            borderRadius: 3,
            padding: '7px 14px',
            fontSize: 12,
            fontFamily: 'var(--f-mono)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: count === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Clear my history
        </button>
      )}

      {confirming && (
        <div className="space-y-2">
          <label
            style={{
              display: 'block',
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              color: 'var(--ink-dim)',
              letterSpacing: '0.06em',
              marginBottom: 6,
            }}
          >
            Type <code style={{ color: 'var(--red)' }}>DELETE</code> to confirm.
          </label>
          <input
            type="text"
            autoFocus
            value={confirmInput}
            onChange={e => setConfirmInput(e.target.value)}
            placeholder="DELETE"
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--rule)',
              color: 'var(--ink)',
              borderRadius: 3,
              padding: '8px 10px',
              fontSize: 13,
              fontFamily: 'var(--f-mono)',
              width: 220,
              marginRight: 10,
            }}
          />
          <button
            onClick={clear}
            disabled={!armed || submitting}
            style={{
              background: armed ? 'var(--red)' : 'transparent',
              color: armed ? 'var(--bg-void)' : 'var(--ink-faint)',
              border: '1px solid var(--red)',
              borderRadius: 3,
              padding: '8px 14px',
              fontSize: 12,
              fontFamily: 'var(--f-mono)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: armed && !submitting ? 'pointer' : 'not-allowed',
              opacity: armed && !submitting ? 1 : 0.6,
              marginRight: 8,
            }}
          >
            {submitting ? 'Clearing…' : 'Confirm clear'}
          </button>
          <button
            onClick={() => {
              setConfirming(false);
              setConfirmInput('');
              setError(null);
            }}
            disabled={submitting}
            style={{
              background: 'transparent',
              color: 'var(--ink-dim)',
              border: '1px solid var(--rule)',
              borderRadius: 3,
              padding: '8px 14px',
              fontSize: 12,
              fontFamily: 'var(--f-mono)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--red)' }}>
          Error: {error}
        </p>
      )}

      {result && (
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--teal)' }}>
          Cleared {result.deleted} {result.deleted === 1 ? 'entry' : 'entries'}.
        </p>
      )}
    </section>
  );
}
