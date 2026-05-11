import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import { citizenInertRedirect } from '@/lib/intel/citizen-gate';
import MineralsWorkspace from '@/components/intel/workspaces/minerals/MineralsWorkspace';

export const metadata = { title: 'eYKON · Critical Minerals' };

export default async function MineralsPage() {
  await citizenInertRedirect('minerals');
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
