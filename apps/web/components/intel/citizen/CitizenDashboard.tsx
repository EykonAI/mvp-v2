import Link from 'next/link';
import InertWorkspaceCard from './InertWorkspaceCard';
import {
  MODULE_INERT_FOR_CITIZEN,
  MODULE_PREVIEW_FOR_CITIZEN,
  MODULE_LABELS,
  type ModuleSlug,
} from '@/lib/intel/modules';

/**
 * Citizen view of /intel. Renders:
 *   • A "Live preview" card for Calibration Ledger linking to /intel/calibration.
 *   • Eight inert tiles for the other workspaces, each routing to
 *     /pricing?from=intel_<slug> on any click.
 *
 * Pro+ users see the regular DashboardHome instead — the /intel page
 * branches on tier before rendering.
 */
export default function CitizenDashboard() {
  // Preview workspace (Calibration). Read-only live data.
  const previewSlug = MODULE_PREVIEW_FOR_CITIZEN[0];

  return (
    <div
      style={{
        padding: '32px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <header>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Observer · Intelligence Center
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 26,
            fontWeight: 500,
            color: 'var(--ink)',
            letterSpacing: '0.02em',
            marginBottom: 8,
          }}
        >
          What you can explore on the free tier
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6, maxWidth: 720 }}>
          One workspace is live for Observer — the Calibration Ledger, our epistemic
          anchor. The other eight are listed here so you can see what is in the
          Intelligence Center; any tile takes you to the upgrade page.
        </p>
      </header>

      {/* Live preview section */}
      <section>
        <h2 className="panel-title" style={{ marginBottom: 12 }}>
          <span className="idx">01</span>Live for Observer
        </h2>
        <Link
          href={`/intel/${previewSlug}`}
          style={{
            display: 'block',
            padding: 22,
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule-soft)',
            borderLeft: '2px solid var(--teal)',
            textDecoration: 'none',
            minHeight: 130,
            transition: 'border-color 120ms ease',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: 8,
            }}
          >
            Read-only preview · 24h-delayed snapshot
          </div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 20,
              fontWeight: 500,
              color: 'var(--ink)',
              letterSpacing: '0.02em',
              marginBottom: 8,
            }}
          >
            {MODULE_LABELS[previewSlug]}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.5, maxWidth: 720 }}>
            How we mark our own predictions and source them. Reliability diagrams per
            persona, Brier scores per feature, and the Predictions Register that
            anchors every claim the platform makes.
          </div>
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginTop: 14,
            }}
          >
            Open the workspace →
          </div>
        </Link>
      </section>

      {/* Inert tiles section */}
      <section>
        <h2 className="panel-title" style={{ marginBottom: 12 }}>
          <span className="idx">02</span>Unlocked with Pro
        </h2>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 14, maxWidth: 720 }}>
          Eight additional compound-signal workspaces, with live data, the AI analyst
          attached, and full export.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 14,
          }}
        >
          {(MODULE_INERT_FOR_CITIZEN as ModuleSlug[]).map(slug => (
            <InertWorkspaceCard key={slug} slug={slug} />
          ))}
        </div>
      </section>
    </div>
  );
}
