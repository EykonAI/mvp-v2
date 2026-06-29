import type { CSSProperties } from 'react';

// Shared visual treatment for the top-nav pillar tabs (Globe · Intel · Notif ·
// AI Analyst) and the COMM dropdown trigger. Extracted from TopNav so CommMenu
// can render as a peer tab — per the 2026-06-28 COMM UX/UI Uplift brief (§2.1a),
// the five pillars read as one cluster.

export const TAB_BASE_STYLE: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  padding: '6px 14px',
  borderRadius: 2,
  border: '1px solid transparent',
  background: 'transparent',
  textDecoration: 'none',
  cursor: 'pointer',
  flex: '0 1 auto',
};

export function activeStyle(active: boolean): CSSProperties {
  return active
    ? {
        color: 'var(--bg-void)',
        background: 'var(--teal)',
        borderColor: 'var(--teal)',
        fontWeight: 500,
      }
    : {
        color: 'var(--ink-dim)',
        background: 'transparent',
        borderColor: 'var(--rule-strong)',
        fontWeight: 400,
      };
}
