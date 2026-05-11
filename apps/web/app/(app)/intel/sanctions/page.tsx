import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import { citizenInertRedirect } from '@/lib/intel/citizen-gate';
import SanctionsWorkspace from '@/components/intel/workspaces/sanctions/SanctionsWorkspace';

export const metadata = { title: 'eYKON · Sanctions Wargame' };

export default async function SanctionsPage() {
  await citizenInertRedirect('sanctions');
  return (
    <WorkspaceShell
      accent="var(--violet)"
      eyebrow="Scenario · Sanctions Wargame"
      title="Sanctions Wargame"
      subtitle="Feature 19 · Fleet-kinship propagation"
    >
      <SanctionsWorkspace />
    </WorkspaceShell>
  );
}
