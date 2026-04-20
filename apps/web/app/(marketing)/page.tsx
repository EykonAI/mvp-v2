import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'eYKON.ai — Geopolitical Intelligence Platform',
  description:
    'Real-time geopolitical intelligence across maritime, aviation, energy, and conflict data — with an AI analyst and 25+ cross-feed modules. Built for analysts, journalists, traders, and concerned citizens.',
};

export default function MarketingHome() {
  return (
    <section
      className="flex flex-col items-center text-center gap-8 px-6"
      style={{ padding: '120px 24px 80px', maxWidth: 1100, margin: '0 auto' }}
    >
      <span
        className="inline-flex items-center gap-2"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          background: 'rgba(25, 208, 184, 0.08)',
          border: '1px solid var(--teal)',
          padding: '6px 14px',
          borderRadius: 20,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--teal)',
            boxShadow: '0 0 8px var(--teal)',
          }}
        />
        Founding Members · Rate locked for life
      </span>

      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 'clamp(36px, 6vw, 64px)',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: 0,
        }}
      >
        Intelligence-grade signals.
        <br />
        <span style={{ color: 'var(--teal)' }}>Prosumer pricing.</span>
      </h1>

      <p
        style={{
          maxWidth: 640,
          fontSize: 17,
          lineHeight: 1.6,
          color: 'var(--ink-dim)',
          margin: 0,
        }}
      >
        Real-time geopolitical intelligence across maritime, aviation, energy, and conflict
        data — with an AI analyst and 25+ cross-feed modules. Built for analysts, journalists,
        traders, and concerned citizens.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-4" style={{ marginTop: 12 }}>
        <Link
          href="/pricing"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--teal)',
            padding: '12px 22px',
            borderRadius: 3,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          See pricing →
        </Link>
        <Link
          href="/app"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            background: 'transparent',
            padding: '11px 22px',
            border: '1px solid var(--teal)',
            borderRadius: 3,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Try the globe →
        </Link>
      </div>

      <p
        style={{
          marginTop: 48,
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          opacity: 0.7,
        }}
      >
        {/* Placeholder landing page — Phase 8 integrates the approved Claude.ai wireframe. */}
        placeholder · phase 8 replaces this with the approved landing design
      </p>
    </section>
  );
}
