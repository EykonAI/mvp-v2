'use client';

import { useState } from 'react';
import type { ShareKind } from '@/lib/share';

type ShareButtonProps = {
  kind: ShareKind;
  // The DB-row id (uuid) being shared, NOT the share_token.
  id: string;
  // 'inline' (default) is the compact treatment used next to text-button
  // toggles (RecentFiresList "Show details", ChatPanel history actions).
  // 'row-action' matches the btnGhost sizing used by Pause/Delete in
  // RulesList so all three buttons in the action group look uniform.
  variant?: 'inline' | 'row-action';
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
export function ShareButton({ kind, id, variant = 'inline' }: ShareButtonProps) {
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

  // Row-action variant matches the btnGhost styling on Pause / Delete
  // in RulesList so all three controls in the action column read as one
  // uniform group. Inline keeps the previous compact treatment for the
  // ChatPanel and RecentFiresList call sites.
  const isRowAction = variant === 'row-action';

  return (
    <button
      onClick={onClick}
      disabled={state.phase === 'creating'}
      title={state.phase === 'copied' ? state.url : 'Create a public share link'}
      className={isRowAction ? 'transition-colors' : 'px-2 py-1 text-xs transition-colors'}
      style={{
        background: 'transparent',
        color: state.phase === 'error' ? 'var(--coral, #d8654f)' : 'var(--ink-dim)',
        border: `1px solid var(${isRowAction ? '--rule-strong' : '--rule'})`,
        borderRadius: 2,
        fontFamily: 'var(--f-mono)',
        fontSize: isRowAction ? 10.5 : undefined,
        letterSpacing: isRowAction ? '0.14em' : '0.08em',
        textTransform: 'uppercase',
        padding: isRowAction ? '5px 12px' : undefined,
        cursor: state.phase === 'creating' ? 'wait' : 'pointer',
        opacity: state.phase === 'creating' ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}
