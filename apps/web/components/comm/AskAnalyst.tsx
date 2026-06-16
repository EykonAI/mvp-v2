'use client';
import { useState } from 'react';

// COMM D3 — "Ask the Analyst" affordance inside a room. POSTs to
// /api/comm/rooms/ask; the question + the analyst's reply land in the room
// and surface via the Thread's 4s poll, so this component just fires the
// request and shows a thinking / error state.

export function AskAnalyst({ roomId }: { roomId: string }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function ask() {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/comm/rooms/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomId, question }),
      });
      if (res.ok) {
        setQ('');
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(
          j.error === 'rate_limited'
            ? 'Too many analyst requests in this room — wait a moment.'
            : 'The analyst is unavailable right now.',
        );
      }
    } catch {
      setErr('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10, border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 10, background: 'var(--bg-panel)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', border: '1px solid var(--teal-dim)', borderRadius: 3, padding: '2px 6px' }}>
          ⬡ Analyst
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-dim)' }}>
          Ask the eYKON analyst — the answer posts to the room for everyone.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value.slice(0, 1000))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void ask();
            }
          }}
          placeholder={busy ? 'Analyst is thinking…' : 'e.g. What is massing near the Strait of Hormuz?'}
          disabled={busy}
          style={{ flex: 1, background: 'var(--bg-void)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 11px', color: 'var(--ink)', fontFamily: 'var(--f-body)', fontSize: 13 }}
        />
        <button
          onClick={() => void ask()}
          disabled={busy || !q.trim()}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10.5,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--teal)',
            border: '1px solid var(--teal-dim)',
            borderRadius: 4,
            padding: '0 14px',
            cursor: busy || !q.trim() ? 'default' : 'pointer',
            opacity: busy || !q.trim() ? 0.5 : 1,
          }}
        >
          {busy ? '…' : 'Ask'}
        </button>
      </div>
      {err && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 6 }}>{err}</div>}
    </div>
  );
}
