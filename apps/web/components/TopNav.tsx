'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WelcomeGreeting from '@/components/WelcomeGreeting';
import NotificationBell from '@/components/NotificationBell';
import CalibrationBadge from '@/components/CalibrationBadge';
import ConvergenceBadge from '@/components/ConvergenceBadge';
import LogoutButton from '@/components/LogoutButton';
import CommMenu from '@/components/CommMenu';
import AccountMenu from '@/components/AccountMenu';
import { TAB_BASE_STYLE, activeStyle } from '@/components/navTabStyles';

interface TopNavProps {
  chatOpen?: boolean;
  onChatToggle?: () => void;
}

/**
 * Global top bar. Brief §3.1 split the bar into two zones:
 *   • Left: brand mark, "Geopolitical Intelligence" tagline, WELCOME
 *           greeting, a stacked Account/Log-out control, LIVE pill, the
 *           Calibration + Convergence trust badges, and the notification bell.
 *   • Right: the five-pillar cluster — COMM ▾ · GLOBE · INTEL · NOTIF ·
 *           AI ANALYST (the bell now lives by the trust badges so these read
 *           as five homogeneous tabs). COMM (a dropdown) sits just left of a
 *           fixed-width inner cluster whose width equals the AI Chat panel
 *           (--chat-panel-width in globals.css), so the GLOBE tab's left edge
 *           stays vertically above the panel's left edge (UX Uplift §2.1a).
 *
 * GLOBE/INTEL/NOTIF are <Link>s; AI ANALYST is a <button> toggling the
 * side panel; COMM is a dropdown styled as a peer tab. All share
 * TAB_BASE_STYLE (navTabStyles.ts) so the cluster reads as one unit.
 */
export default function TopNav({ chatOpen, onChatToggle }: TopNavProps) {
  const pathname = usePathname();
  const isGlobe = pathname?.startsWith('/app') ?? false;
  const isIntel = pathname?.startsWith('/intel') ?? false;
  const isNotif = pathname?.startsWith('/notif') ?? false;

  return (
    <nav
      className="flex items-center sticky top-0 z-30 backdrop-blur"
      style={{
        background: 'rgba(10, 18, 32, 0.9)',
        borderBottom: '1px solid var(--rule-soft)',
        paddingLeft: 24,
        paddingRight: 0,
        paddingTop: 12,
        paddingBottom: 12,
        gap: 28,
      }}
    >
      {/* Brand — links home to the globe (/app). TopNav renders only in the
          signed-in app (globe / intel / notif), so /app is always the right
          destination; the landing logo (#top) lives in Landing.tsx, untouched. */}
      <Link
        href="/app"
        title="Back to the globe"
        className="flex items-center gap-2.5"
        style={{ textDecoration: 'none' }}
      >
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
      </Link>

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

      <WelcomeGreeting />
      {/* Account + Log out stacked vertically to save horizontal real-estate. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <AccountMenu />
        <LogoutButton />
      </div>

      {/* LIVE pill */}
      <span
        className="hidden lg:inline-flex items-center gap-1.5"
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

      {/* Persistent trust badges — Calibration ("we grade ourselves")
          paired with Convergence ("independent feeds agree"). Both use
          the stacked label-over-metric layout; they live in the left
          zone after Live, occupying negative space between the
          brand-info group and the right tab cluster without disturbing
          the chat-panel-width alignment below. */}
      <CalibrationBadge />
      <ConvergenceBadge />
      {/* Notification bell — sits with the trust badges (between Convergence
          and the COMM pillar) so the right cluster reads as five homogeneous
          pillar tabs, not four-plus-a-glyph. */}
      <NotificationBell />

      {/* Five-pillar cluster. COMM ▾ sits immediately left of the
          fixed-width inner cluster so all five pillars read as one set,
          while the inner cluster keeps its --chat-panel-width alignment
          (GLOBE's left edge stays above the chat panel). */}
      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <CommMenu />
        {/* Inner cluster — width matches the AI Chat panel column so
            GLOBE's left edge sits directly above the panel's left edge. */}
        <div
          style={{
            width: 'var(--chat-panel-width)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            paddingLeft: 8,
            paddingRight: 16,
          }}
        >
          <TabLink href="/app" label="Globe" active={isGlobe} />
          <TabLink href="/intel" label="Intel" active={isIntel} />
          <TabLink href="/notif" label="Notif" active={isNotif} />
          <TabButton
            label="AI Analyst"
            active={!!chatOpen}
            onClick={onChatToggle}
            disabled={!onChatToggle}
          />
        </div>
      </div>
    </nav>
  );
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} style={{ ...TAB_BASE_STYLE, ...activeStyle(active) }}>
      {label}
    </Link>
  );
}

function TabButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={`Toggle ${label}`}
      aria-pressed={active}
      disabled={disabled}
      style={{
        ...TAB_BASE_STYLE,
        ...activeStyle(active),
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  );
}
