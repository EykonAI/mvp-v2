import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import CommoditiesWorkspace from '@/components/intel/workspaces/commodities/CommoditiesWorkspace';

export const metadata = { title: 'eYKON · Commodities' };

export default function CommoditiesPage() {
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
