'use client';

import { useState } from 'react';
import type { ShareKind } from '@/lib/share';

type ShareButtonProps = {
  kind: ShareKind;
  // The DB-row id (uuid) being shared, NOT the share_token.
  id: string;
};

type State =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'copied'; url: string }
  | { phase: 'error'; message: string };

/**
 * Inline Share button. On click: POSTs to /api/share/create,
 * receives the public URL (with ?ref=<owner.public_id> already
 * baked in by the API), and copies it to the clipboard. On
 * subsequent clicks the API returns the same token (idempotent).
 *
 * Drop into anywhere the owner is looking at one of their own
 * shareable rows: ChatPanel history entries (PR 4), RecentFiresList
 * fires (PR 5).
 */
export function ShareButton({ kind, id }: ShareButtonProps) {
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function onClick() {
    if (state.phase === 'creating') return;
    setState({ phase: 'creating' });
    try {
      const res = await fetch('/api/share/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ phase: 'error', message: body.error ?? `HTTP ${res.status}` });
        setTimeout(() => setState({ phase: 'idle' }), 2500);
        return;
      }
      const body = (await res.json()) as { url: string };
      try {
        await navigator.clipboard.writeText(body.url);
      } catch {
        // Clipboard write blocked (e.g. iframe without permission). Still
        // mark as 'copied' so the user sees the URL — they can copy
        // manually from the visible state.
      }
      setState({ phase: 'copied', url: body.url });
      setTimeout(() => setState({ phase: 'idle' }), 4000);
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'failed' });
      setTimeout(() => setState({ phase: 'idle' }), 2500);
    }
  }

  const label =
    state.phase === 'creating'
      ? 'Creating link…'
      : state.phase === 'copied'
        ? 'Link copied'
        : state.phase === 'error'
          ? state.message
          : 'Share';

  return (
    <button
      onClick={onClick}
      disabled={state.phase === 'creating'}
      title={state.phase === 'copied' ? state.url : 'Create a public share link'}
      className="px-2 py-1 text-xs transition-colors"
      style={{
        background: 'transparent',
        color: state.phase === 'error' ? 'var(--coral, #d8654f)' : 'var(--ink-dim)',
        border: '1px solid var(--rule)',
        borderRadius: 2,
        fontFamily: 'var(--f-mono)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        cursor: state.phase === 'creating' ? 'wait' : 'pointer',
        opacity: state.phase === 'creating' ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}
