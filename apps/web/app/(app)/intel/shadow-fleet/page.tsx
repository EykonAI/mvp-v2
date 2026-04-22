import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import ShadowFleetWorkspace from '@/components/intel/workspaces/shadowFleet/ShadowFleetWorkspace';

export const metadata = { title: 'eYKON · Shadow Fleet Profiler' };

export default function ShadowFleetPage() {
  return (
    <WorkspaceShell
      accent="var(--red)"
      eyebrow="Investigation · Shadow Fleet"
      title="Shadow Fleet Profiler"
      subtitle="Features 2 · 10"
    >
      <ShadowFleetWorkspace />
    </WorkspaceShell>
  );
}
