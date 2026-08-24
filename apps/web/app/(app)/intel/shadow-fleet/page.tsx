import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import { citizenInertRedirect } from '@/lib/intel/citizen-gate';
import ShadowFleetWorkspace from '@/components/intel/workspaces/shadowFleet/ShadowFleetWorkspace';

export const metadata = { title: 'eYKON · Shadow Fleet — Dark Contact Board' };

export default async function ShadowFleetPage() {
  await citizenInertRedirect('shadow-fleet');
  return (
    <WorkspaceShell
      accent="var(--red)"
      eyebrow="Investigation · Shadow Fleet"
      title="Dark Contact Board"
      subtitle="Events, not vessels · sea"
    >
      <ShadowFleetWorkspace />
    </WorkspaceShell>
  );
}
