import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import { citizenInertRedirect } from '@/lib/intel/citizen-gate';
import CascadeWorkspace from '@/components/intel/workspaces/cascade/CascadeWorkspace';

export const metadata = { title: 'eYKON · Cascade Map' };

export default async function CascadePage() {
  await citizenInertRedirect('cascade');
  return (
    <WorkspaceShell
      accent="var(--amber)"
      eyebrow="Scenario · Infrastructure Cascade"
      title="Cascade Map"
      subtitle="Feature 11 · Max-flow reroute solver"
    >
      <CascadeWorkspace />
    </WorkspaceShell>
  );
}
