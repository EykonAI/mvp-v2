'use client';
import WorkspaceNav from '@/components/intel/shell/WorkspaceNav';
import PersonaSwitcher from '@/components/intel/shell/PersonaSwitcher';
import InterestGraph from './InterestGraph';
import ConvergenceFeed from './ConvergenceFeed';
import PostureViewport from './PostureViewport';
import IntelligenceFeed from './IntelligenceFeed';
import ContextualActions from './ContextualActions';
import CitizenBrief from './CitizenBrief';
import { usePersona } from '@/components/intel/shell/PersonaContext';

/** Intelligence Dashboard — home composition. */
export default function DashboardHome() {
  return (
    <div className="flex flex-col">
      <div className="intel-main">
        {/* LEFT RAIL — 300px */}
        <div className="intel-col">
          <PanelSection index="01" title="Interest Graph" meta="Personal + blind-spot">
            <div style={{ padding: 0 }}>
              <InterestGraph />
            </div>
          </PanelSection>

          <PanelSection index="02" title="Convergence Feed" meta="Anomaly of anomalies">
            <ConvergenceFeed />
          </PanelSection>
        </div>

        {/* CENTRE VIEWPORT — fluid */}
        <div className="intel-col">
          <CenterSurface />
          <PanelSection index="04" title="Intelligence Feed" meta="Compound signals · persona-aware">
            <IntelligenceFeed />
          </PanelSection>
        </div>

        {/* RIGHT RAIL — 340px */}
        <div className="intel-col">
          <PanelSection index="P" title="Persona">
            <PersonaSwitcher />
          </PanelSection>

          <PanelSection index="A" title="Contextual Actions">
            <ContextualActions />
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

/**
 * For persona=citizen the central Posture Viewport is replaced by a
 * 300-word plain-language briefing (Feature 14). For all other
 * personas the viewport renders normally.
 */
function CenterSurface() {
  const { persona } = usePersona();
  if (persona === 'citizen') {
    return (
      <PanelSection index="03" title="Citizen Brief" meta="300-word plain-language briefing">
        <CitizenBrief />
      </PanelSection>
    );
  }
  return (
    <PanelSection index="03" title="Posture Shift · Live" meta="5 theatres pinned">
      <PostureViewport />
    </PanelSection>
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
