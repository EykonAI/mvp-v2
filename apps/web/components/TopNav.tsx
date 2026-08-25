'use client';
import WelcomeGreeting from '@/components/WelcomeGreeting';
import NotificationBell from '@/components/NotificationBell';
import CalibrationBadge from '@/components/CalibrationBadge';
import ConvergenceBadge from '@/components/ConvergenceBadge';
import LogoutButton from '@/components/LogoutButton';
import AccountMenu from '@/components/AccountMenu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { TAB_BASE_STYLE, activeStyle } from '@/components/navTabStyles';

interface TopNavProps {
  chatOpen?: boolean;
  onChatToggle?: () => void;
}

/**
 * Shell header (dashboard-UI upgrade). The old top bar carried brand +
 * the six-pillar tab cluster; both moved into EykonSidebar. What remains
 * here is the per-page header inside the SidebarInset:
 *   • Left: sidebar trigger, WELCOME greeting, LIVE pill.
 *   • Right: Calibration + Convergence trust badges, notification bell,
 *            docked-analyst toggle (pages that mount the panel), and the
 *            stacked Account/Log-out control.
 *
 * The props interface is unchanged, so every page that rendered
 * <TopNav chatOpen onChatToggle> keeps working with zero edits.
 */
export default function TopNav({ chatOpen, onChatToggle }: TopNavProps) {
  return (
    <header
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-eykon-bg-navy/90 px-4 backdrop-blur"
    >
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
      <Separator orientation="vertical" className="h-5 bg-eykon-rule-strong" />

      <WelcomeGreeting />

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

      <div className="ml-auto flex items-center gap-3">
        <CalibrationBadge />
        <ConvergenceBadge />
        <NotificationBell />

        {onChatToggle && (
          <button
            onClick={onChatToggle}
            aria-label="Toggle docked analyst panel"
            aria-pressed={!!chatOpen}
            title={chatOpen ? 'Hide docked analyst panel' : 'Show docked analyst panel'}
            style={{
              ...TAB_BASE_STYLE,
              ...activeStyle(!!chatOpen),
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            ◫
          </button>
        )}

        {/* Account + Log out stacked vertically, as before. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <AccountMenu />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
