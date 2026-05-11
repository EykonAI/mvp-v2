'use client';
import Link from 'next/link';
import { MODULE_LABELS, type ModuleSlug } from '@/lib/intel/modules';

// One-line description per workspace. Used on Citizen-view inert tiles
// so the user understands what is behind the upgrade. Kept short — the
// tile itself is read-once context, not a marketing page.
const SHORT_DESC: Record<ModuleSlug, string> = {
  calibration: 'How we mark our own predictions and source them.',
  cascade: 'Propagation modelling for shocks across infrastructure and trade.',
  chokepoint: 'Stress-test single-point-of-failure routes under disruption.',
  commodities: 'Supply / demand balance and chokepoint exposure per commodity.',
  minerals: 'Critical-minerals supply chains, mines, and refining geography.',
  'precursor-analogs': 'Historical analogs for emerging crises, with caveats.',
  'regime-shifts': 'Detection of structural changes in conflict and trade patterns.',
  sanctions: 'Wargame the second-order effects of new sanctions packages.',
  'shadow-fleet': 'Vessels evading AIS, sanctioned-port calls, ownership opacity.',
};

interface Props {
  slug: ModuleSlug;
}

/**
 * Citizen-view inert workspace tile. Visible but greyed-out; clicking
 * anywhere on the card routes to /pricing?from=intel_<slug>. No live
 * data is fetched; the tile renders title + one-line description +
 * "Pro" badge purely from constants.
 *
 * Used inside CitizenDashboard for the eight non-Calibration slugs per
 * the trial-mechanism brief §5.2.
 */
export default function InertWorkspaceCard({ slug }: Props) {
  return (
    <Link
      href={`/pricing?from=intel_${slug}`}
      className="block group"
      style={{
        position: 'relative',
        padding: 18,
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule-soft)',
        borderLeft: '2px solid var(--rule-strong)',
        textDecoration: 'none',
        cursor: 'not-allowed',
        opacity: 0.6,
        transition: 'opacity 120ms ease',
        minHeight: 110,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 10,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.opacity = '0.85';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.opacity = '0.6';
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          padding: '2px 8px',
          background: 'var(--rule-strong)',
          color: 'var(--ink)',
          fontFamily: 'var(--f-mono)',
          fontSize: 9.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          borderRadius: 3,
        }}
      >
        Pro
      </span>
      <div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 15,
            fontWeight: 500,
            color: 'var(--ink)',
            letterSpacing: '0.02em',
            marginBottom: 6,
          }}
        >
          {MODULE_LABELS[slug]}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-dim)',
            lineHeight: 1.5,
          }}
        >
          {SHORT_DESC[slug]}
        </div>
      </div>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
        }}
      >
        Upgrade to unlock →
      </div>
    </Link>
  );
}
