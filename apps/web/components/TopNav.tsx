'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface TopNavProps {
  chatOpen?: boolean;
  onChatToggle?: () => void;
}

/**
 * Global top bar. Mounts above both the globe view (/) and the
 * Intelligence Center (/intel/**). Renders a brand mark, a Globe/Intel
 * toggle (Next.js links — path-driven highlight), a LIVE pill, and a
 * chat toggle when the parent provides one.
 */
export default function TopNav({ chatOpen, onChatToggle }: TopNavProps) {
  const pathname = usePathname();
  const isIntel = pathname?.startsWith('/intel') ?? false;

  return (
    <nav
      className="flex items-center gap-7 px-6 py-3 sticky top-0 z-30 backdrop-blur"
      style={{
        background: 'rgba(10, 18, 32, 0.9)',
        borderBottom: '1px solid var(--rule-soft)',
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <div className="relative" style={{ width: 28, height: 18 }}>
          <svg viewBox="0 0 28 18" width="28" height="18">
            <path
              d="M2 9 L14 2 L26 9 L14 16 Z"
              fill="none"
              stroke="var(--teal)"
              strokeWidth="1.4"
            />
            <circle cx="14" cy="9" r="1.8" fill="var(--teal)" />
          </svg>
        </div>
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: '0.12em',
            color: 'var(--ink)',
          }}
        >
          eYKON
          <sup
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              color: 'var(--teal)',
              letterSpacing: '0.15em',
              marginLeft: 2,
            }}
          >
            .ai
          </sup>
        </span>
      </div>

      <div style={{ width: 1, height: 22, background: 'var(--rule-strong)' }} />

      <span
        className="hidden sm:inline"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
        }}
      >
        Geopolitical Intelligence
      </span>

      {/* Mode toggle */}
      <div
        className="ml-auto mr-5 flex"
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--rule)',
          borderRadius: 3,
          padding: 2,
        }}
      >
        <ToggleLink href="/app" label="Globe" active={!isIntel} />
        <ToggleLink href="/intel" label="Intel" active={isIntel} />
      </div>

      {/* LIVE pill */}
      <span
        className="inline-flex items-center gap-1.5"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.15em',
          color: 'var(--ink-dim)',
          textTransform: 'uppercase',
        }}
      >
        <span
          className="pulse-dot"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--teal)',
            boxShadow: '0 0 8px var(--teal)',
          }}
        />
        Live
      </span>

      {/* Chat toggle */}
      {onChatToggle && (
        <button
          onClick={onChatToggle}
          aria-label="Toggle AI chat"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: chatOpen ? 'var(--teal)' : 'var(--ink)',
            background: 'transparent',
            border: `1px solid ${chatOpen ? 'var(--teal-dim)' : 'var(--rule-strong)'}`,
            padding: '5px 12px',
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          AI Chat
        </button>
      )}
    </nav>
  );
}

function ToggleLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: active ? 'var(--bg-void)' : 'var(--ink-dim)',
        background: active ? 'var(--teal)' : 'transparent',
        fontWeight: active ? 500 : 400,
        padding: '5px 14px',
        borderRadius: 2,
        textDecoration: 'none',
      }}
    >
      {label}
    </Link>
  );
}
