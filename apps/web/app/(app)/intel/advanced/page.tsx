import type { Metadata } from 'next';
import Link from 'next/link';
import { AdvancedScenariosBanner } from '@/components/intel/AdvancedScenariosBanner';
import { MODULE_LABELS, modulesByTier, type ModuleSlug } from '@/lib/subscription';

export const metadata: Metadata = {
  title: 'Advanced Scenarios — eYKON.ai Intelligence Center',
  robots: { index: false, follow: false },
};

// Landing page for the four institutional-grade workspaces:
// Chokepoint Simulator, Sanctions Wargame, Cascade Propagation,
// Precursor Analogs. Tier gating happens at the parent layout
// (/intel/layout.tsx), so this page is rendered only for Pro+.
//
// One-line description per workspace lives here so the page is
// self-contained — the prompt §6.3 noted MODULE_DESCRIPTIONS may
// not exist yet; this map fills the gap without churning the
// global subscription registry.

const ADVANCED_DESCRIPTIONS: Record<ModuleSlug, string> = {
  chokepoint:
    'Stress-test scenario for the world’s 26 maritime chokepoints — closure type, duration, diversion lag.',
  sanctions:
    'Multi-body sanctions propagation game. Configure issuing bodies, target entities, and depth.',
  cascade:
    'Multi-domain shock propagation across infrastructure, supply chains, and conflict feeds.',
  'precursor-analogs':
    'Cosine-matched historical episodes against any pinned theatre — labelled precursor library.',
  // Non-advanced entries — never rendered here, but kept exhaustive
  // so the Record<ModuleSlug, string> typecheck stays honest.
  calibration: '',
  commodities: '',
  minerals: '',
  'regime-shifts': '',
  'shadow-fleet': '',
};

const ADVANCED_SLUGS = modulesByTier('advanced');

export default function AdvancedScenariosPage() {
  return (
    <div style={{ padding: '32px 40px 56px', maxWidth: 1200, margin: '0 auto' }}>
      <div
        className="eyebrow"
        style={{
          marginBottom: 8,
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
        }}
      >
        Intelligence Center · Advanced Scenarios
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 28,
          fontWeight: 500,
          color: 'var(--ink)',
          letterSpacing: '0.04em',
          marginBottom: 24,
        }}
      >
        Institutional-grade analysis
      </h1>

      <AdvancedScenariosBanner />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 14,
          marginTop: 8,
        }}
      >
        {ADVANCED_SLUGS.map(slug => (
          <WorkspaceCard
            key={slug}
            slug={slug}
            label={MODULE_LABELS[slug]}
            description={ADVANCED_DESCRIPTIONS[slug]}
          />
        ))}
      </div>
    </div>
  );
}

function WorkspaceCard({
  slug,
  label,
  description,
}: {
  slug: ModuleSlug;
  label: string;
  description: string;
}) {
  return (
    <Link
      href={`/intel/${slug}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '20px 22px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'var(--ink)',
        minHeight: 140,
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
        }}
      >
        Workspace
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.5 }}>{description}</div>
      <div
        style={{
          marginTop: 'auto',
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
        }}
      >
        Open →
      </div>
    </Link>
  );
}
