import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import MineralsWorkspace from '@/components/intel/workspaces/minerals/MineralsWorkspace';

export const metadata = { title: 'eYKON · Critical Minerals' };

export default function MineralsPage() {
  return (
    <WorkspaceShell
      accent="var(--violet)"
      eyebrow="Supply · Critical Minerals"
      title="Critical Minerals Cascade"
      subtitle="Feature 3"
    >
      <MineralsWorkspace />
    </WorkspaceShell>
  );
}
