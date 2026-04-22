import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import PrecursorAnalogsWorkspace from '@/components/intel/workspaces/precursorAnalogs/PrecursorAnalogsWorkspace';

export const metadata = { title: 'eYKON · Precursor Analogs' };

export default function PrecursorAnalogsPage() {
  return (
    <WorkspaceShell
      accent="var(--teal)"
      eyebrow="Library · Historical Analogs"
      title="Precursor Pattern Library"
      subtitle="Feature 24"
    >
      <PrecursorAnalogsWorkspace />
    </WorkspaceShell>
  );
}
