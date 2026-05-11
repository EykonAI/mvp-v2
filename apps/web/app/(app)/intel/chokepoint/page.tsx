import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import { citizenInertRedirect } from '@/lib/intel/citizen-gate';
import ChokepointWorkspace from '@/components/intel/workspaces/chokepoint/ChokepointWorkspace';

export const metadata = { title: 'eYKON · Chokepoint Simulator' };

export default async function ChokepointPage() {
  await citizenInertRedirect('chokepoint');
  return (
    <WorkspaceShell
      accent="var(--coral)"
      eyebrow="Scenario · Closure Simulator"
      title="Chokepoint Simulator"
      subtitle="Feature 18 · Closure + Reroute model"
    >
      <ChokepointWorkspace />
    </WorkspaceShell>
  );
}
