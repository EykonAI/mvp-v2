import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import { citizenInertRedirect } from '@/lib/intel/citizen-gate';
import CommoditiesWorkspace from '@/components/intel/workspaces/commodities/CommoditiesWorkspace';

export const metadata = { title: 'eYKON · Commodities' };

export default async function CommoditiesPage() {
  await citizenInertRedirect('commodities');
  return (
    <WorkspaceShell
      accent="var(--wheat)"
      eyebrow="Persona · Commodities & Trade"
      title="Commodities"
      subtitle="Features 3 · 4 · 6 · 13"
    >
      <CommoditiesWorkspace />
    </WorkspaceShell>
  );
}
