'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MODULE_LABELS,
  MODULE_TIERS,
  modulesByTier,
  type ModuleSlug,
} from '@/lib/subscription';

// Workspace nav for the Intelligence Center. Three surfaced regions:
//   • Primary strip (hero)     — Calibration Ledger · Shadow Fleet · Regime Shifts.
//   • Secondary strip (visible) — Commodities · Critical Minerals.
//   • Right-aligned entry      — Advanced Scenarios → /intel/advanced
//     (a 4-card landing for Chokepoint, Sanctions, Cascade, Precursor).
//
// All nine workspaces remain accessible at /intel/<slug>; the four
// advanced ones are also reachable directly via deep links and via
// the 4 cards on /intel/advanced. Tier-gating semantics unchanged
// (every workspace stays Pro+).
//
// Active-state rules:
//   • A hero or visible workspace is active when the pathname matches
//     /intel/<slug> (or sub-path).
//   • The Advanced Scenarios entry is active when the pathname is
//     /intel/advanced OR any of the four advanced /intel/<slug> routes.

const HERO_ORDER: ModuleSlug[] = ['calibration', 'shadow-fleet', 'regime-shifts'];
const VISIBLE_ORDER: ModuleSlug[] = ['commodities', 'minerals'];

// Render order is fixed (not derived from MODULE_SLUGS sort) so the
// hero strip always reads Calibration → Shadow Fleet → Regime Shifts.
const HERO_WORKSPACES = HERO_ORDER.map(slug => ({
  slug,
  label: MODULE_LABELS[slug],
  path: `/intel/${slug}`,
}));
const VISIBLE_WORKSPACES = VISIBLE_ORDER.map(slug => ({
  slug,
  label: MODULE_LABELS[slug],
  path: `/intel/${slug}`,
}));
const ADVANCED_WORKSPACES = modulesByTier('advanced').map(slug => ({
  slug,
  label: MODULE_LABELS[slug],
  path: `/intel/${slug}`,
}));

// Backwards-compat: a few call-sites import `WORKSPACES` for shape.
// Keep the export, but order it: home → hero → visible → advanced.
export const WORKSPACES: { slug: string; label: string; path: string }[] = [
  { slug: 'home', label: 'Dashboard', path: '/intel' },
  ...HERO_WORKSPACES,
  ...VISIBLE_WORKSPACES,
  ...ADVANCED_WORKSPACES,
];

const ADVANCED_PATH = '/intel/advanced';
const ADVANCED_SLUGS = new Set(modulesByTier('advanced'));

function isActive(pathname: string, path: string): boolean {
  if (path === '/intel') return pathname === '/intel';
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isAdvancedRoute(pathname: string): boolean {
  if (pathname === ADVANCED_PATH || pathname.startsWith(`${ADVANCED_PATH}/`)) return true;
  for (const slug of ADVANCED_SLUGS) {
    const p = `/intel/${slug}`;
    if (pathname === p || pathname.startsWith(`${p}/`)) return true;
  }
  return false;
}

/**
 * Horizontal workspace nav (default) and vertical variant for the
 * dashboard right-rail. Both surfaces honour the same three regions.
 */
export default function WorkspaceNav({
  orientation = 'horizontal',
}: {
  orientation?: 'horizontal' | 'vertical';
}) {
  const pathname = usePathname() ?? '/intel';
  const advancedActive = isAdvancedRoute(pathname);

  if (orientation === 'vertical') {
    return (
      <ul className="flex flex-col" style={{ gap: 0 }}>
        <VerticalSectionHeading>Hero</VerticalSectionHeading>
        {HERO_WORKSPACES.map(w => (
          <VerticalItem key={w.slug} workspace={w} active={isActive(pathname, w.path)} />
        ))}
        <VerticalSectionHeading>Visible</VerticalSectionHeading>
        {VISIBLE_WORKSPACES.map(w => (
          <VerticalItem key={w.slug} workspace={w} active={isActive(pathname, w.path)} />
        ))}
        <VerticalSectionHeading>Advanced Scenarios</VerticalSectionHeading>
        <VerticalItem
          workspace={{ slug: 'advanced', label: 'Open Advanced Scenarios', path: ADVANCED_PATH }}
          active={advancedActive}
          badge={ADVANCED_WORKSPACES.length}
        />
      </ul>
    );
  }

  return (
    <nav
      className="sticky bottom-0 z-20 flex items-center px-6 backdrop-blur"
      style={{
        background: 'rgba(10, 18, 32, 0.92)',
        borderTop: '1px solid var(--rule-soft)',
        height: 40,
        gap: 0,
      }}
    >
      {/* Primary strip — hero workspaces, prominent treatment */}
      <div className="flex items-center" style={{ gap: 4 }}>
        {HERO_WORKSPACES.map(w => (
          <PillTab
            key={w.slug}
            href={w.path}
            label={w.label}
            active={isActive(pathname, w.path)}
          />
        ))}
      </div>

      {/* Spacer */}
      <div style={{ width: 1, height: 22, background: 'var(--rule-soft)', margin: '0 12px' }} />

      {/* Secondary strip — visible workspaces, subtler weight.
          Hides into overflow on narrow viewports (lg breakpoint). */}
      <div className="hidden lg:flex items-center" style={{ gap: 0 }}>
        {VISIBLE_WORKSPACES.map(w => (
          <FlatTab
            key={w.slug}
            href={w.path}
            label={w.label}
            active={isActive(pathname, w.path)}
          />
        ))}
      </div>

      {/* Right-aligned: Advanced Scenarios entry. Always visible. */}
      <Link
        href={ADVANCED_PATH}
        className="ml-auto inline-flex items-center"
        style={{
          gap: 8,
          padding: '0 14px',
          height: 40,
          textDecoration: 'none',
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: advancedActive ? 'var(--teal)' : 'var(--ink-dim)',
          borderBottom: advancedActive ? '2px solid var(--teal)' : '2px solid transparent',
        }}
      >
        <span>Advanced Scenarios</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 18,
            height: 16,
            padding: '0 5px',
            borderRadius: 8,
            background: advancedActive ? 'var(--teal)' : 'var(--rule-strong)',
            color: advancedActive ? 'var(--bg-void)' : 'var(--ink)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0,
          }}
        >
          {ADVANCED_WORKSPACES.length}
        </span>
      </Link>
    </nav>
  );
}

function PillTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 30,
        padding: '0 14px',
        margin: '5px 0',
        textDecoration: 'none',
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        fontWeight: active ? 500 : 400,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        background: active ? 'var(--teal)' : 'transparent',
        color: active ? 'var(--bg-void)' : 'var(--ink-dim)',
        border: `1px solid ${active ? 'var(--teal)' : 'var(--rule-strong)'}`,
        borderRadius: 16,
      }}
    >
      {label}
    </Link>
  );
}

function FlatTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 12px',
        height: 40,
        textDecoration: 'none',
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: active ? 'var(--teal)' : 'var(--ink-faint)',
        borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent',
      }}
    >
      {label}
    </Link>
  );
}

function VerticalSectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <li
      style={{
        padding: '12px 14px 6px',
        fontFamily: 'var(--f-mono)',
        fontSize: 9.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
      }}
    >
      {children}
    </li>
  );
}

function VerticalItem({
  workspace,
  active,
  badge,
}: {
  workspace: { slug: string; label: string; path: string };
  active: boolean;
  badge?: number;
}) {
  return (
    <li style={{ borderBottom: '1px solid var(--rule-soft)' }}>
      <Link
        href={workspace.path}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 14px',
          textDecoration: 'none',
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: active ? 'var(--teal)' : 'var(--ink-dim)',
          background: active ? 'rgba(25,208,184,0.04)' : 'transparent',
        }}
      >
        <span style={{ color: active ? 'var(--teal)' : 'var(--ink-faint)' }}>◆</span>
        <span style={{ flex: 1 }}>{workspace.label}</span>
        {typeof badge === 'number' && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 18,
              height: 16,
              padding: '0 5px',
              borderRadius: 8,
              background: 'var(--rule-strong)',
              color: 'var(--ink)',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {badge}
          </span>
        )}
      </Link>
    </li>
  );
}
