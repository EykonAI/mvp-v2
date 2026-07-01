'use client';

import { useState } from 'react';

// Founder review actions for one newsjack draft. Posts to
// /api/admin/newsjack/[id]; refreshes the row's visible state on success.

export default function NewsjackActions({ draftId, posts }: { draftId: string; posts: string[] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function act(action: 'approve' | 'reject') {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/newsjack/${draftId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = (await r.json()) as { error?: string; published?: boolean; detail?: string };
      if (!r.ok) {
        setMsg(j.error ?? 'error');
      } else if (action === 'approve') {
        setDone('approved');
        setMsg(j.published ? 'approved + sent to publish webhook' : `approved — ${j.detail ?? 'post manually'}`);
      } else {
        setDone('rejected');
        setMsg('rejected');
      }
    } catch {
      setMsg('network error');
    }
    setBusy(false);
  }

  function copyThread() {
    void navigator.clipboard?.writeText(posts.join('\n\n'));
    setMsg('thread copied');
  }

  const btn: React.CSSProperties = {
    fontFamily: 'var(--f-mono)',
    fontSize: 11,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid var(--rule)',
    background: 'transparent',
    color: 'var(--ink)',
    cursor: busy ? 'default' : 'pointer',
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
      <button style={{ ...btn, borderColor: 'var(--teal)', color: 'var(--teal)' }} disabled={busy || !!done} onClick={() => act('approve')}>
        Approve + publish
      </button>
      <button style={{ ...btn, borderColor: 'var(--amber)', color: 'var(--amber)' }} disabled={busy || !!done} onClick={() => act('reject')}>
        Reject
      </button>
      <button style={btn} disabled={busy} onClick={copyThread}>
        Copy thread
      </button>
      {msg && <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{msg}</span>}
    </div>
  );
}
