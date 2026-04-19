'use client';
import WorkspaceNav from '@/components/intel/shell/WorkspaceNav';
import PersonaSwitcher from '@/components/intel/shell/PersonaSwitcher';

/**
 * Intelligence Dashboard — home composition.
 * Phase 1 scaffold — Phase 3 replaces the placeholder cells with
 * the live Interest Graph, Convergence Feed, Posture Viewport, and
 * enriched Intelligence Feed.
 */
export default function DashboardHome() {
  return (
    <div className="flex flex-col">
      <div className="intel-main">
        {/* LEFT RAIL — 300px */}
        <div className="intel-col">
          <PanelSection index="01" title="Interest Graph" meta="Personal + blind-spot">
            <div
              style={{
                height: 320,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-faint)',
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              Graph — Phase 3
            </div>
          </PanelSection>

          <PanelSection index="02" title="Convergence Feed" meta="Anomaly-of-anomalies">
            <div
              style={{
                minHeight: 240,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-faint)',
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              Feed — Phase 3
            </div>
          </PanelSection>
        </div>

        {/* CENTRE VIEWPORT — fluid */}
        <div className="intel-col">
          <PanelSection index="03" title="Posture Shift" meta="Live · 5 theatres pinned">
            <div
              style={{
                minHeight: 520,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-faint)',
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              Posture Viewport — Phase 3
            </div>
          </PanelSection>

          <PanelSection index="04" title="Intelligence Feed" meta="Compound signals · persona-aware">
            <div
              style={{
                minHeight: 280,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-faint)',
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              Feed cards — Phase 3
            </div>
          </PanelSection>
        </div>

        {/* RIGHT RAIL — 340px */}
        <div className="intel-col">
          <PanelSection index="P" title="Persona">
            <PersonaSwitcher />
          </PanelSection>

          <PanelSection index="W" title="Workspaces">
            <WorkspaceNav orientation="vertical" />
          </PanelSection>
        </div>
      </div>

      <WorkspaceNav orientation="horizontal" />
    </div>
  );
}

function PanelSection({
  index,
  title,
  meta,
  children,
}: {
  index: string;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="intel-panel">
      <div className="intel-panel-head">
        <span className="panel-title">
          <span className="idx">{index}</span>
          {title}
        </span>
        {meta && <span className="panel-meta">{meta}</span>}
      </div>
      <div className="intel-panel-body">{children}</div>
    </section>
  );
}
