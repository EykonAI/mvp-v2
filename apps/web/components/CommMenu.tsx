'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

// Groups the COMM surfaces (Profile · Messages · Rooms) under one
// top-nav button. "Profile" → /me, which redirects to the signed-in
// user's own public profile (/u/<handle>).
//
// Outside-click close uses a document-level listener rather than a
// fixed-position backdrop: the nav has backdrop-blur (a backdrop-filter),
// which would confine any position:fixed child to the nav's own box and
// stop it catching clicks elsewhere on the page.

const LINKS = [
  { href: '/me', label: 'Profile' },
  { href: '/messages', label: 'Messages' },
  { href: '/rooms', label: 'Rooms' },
];

const trigger: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10.5,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-dim)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};
const menu: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  zIndex: 50,
  minWidth: 130,
  background: 'var(--bg-panel)',
  border: '1px solid var(--rule)',
  borderRadius: 4,
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};
const item: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-dim)',
  textDecoration: 'none',
  padding: '8px 10px',
  borderRadius: 3,
};

export default function CommMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" style={trigger}>
        COMM {open ? '▴' : '▾'}
      </button>
      {open && (
        <div role="menu" style={menu}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} prefetch={false} onClick={() => setOpen(false)} style={item}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
