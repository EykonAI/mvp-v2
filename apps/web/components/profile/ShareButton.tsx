'use client';
import { useState } from 'react';
import type { CSSProperties } from 'react';

// Copies the current profile URL to the clipboard. The OG card at
// /u/<handle>/card.png gives the link a rich preview when pasted.

const chipBtn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.05em',
  padding: '6px 10px',
  borderRadius: 3,
  color: 'var(--ink-dim)',
  background: 'transparent',
  border: '1px solid var(--rule-soft)',
  cursor: 'pointer',
};

export function ShareButton() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const url = typeof window !== 'undefined' ? window.location.href : '';
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <button onClick={copy} title="Copy link to this profile" style={chipBtn}>
      {copied ? 'Copied ✓' : 'Share'}
    </button>
  );
}
