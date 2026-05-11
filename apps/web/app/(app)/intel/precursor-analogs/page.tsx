import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import { citizenInertRedirect } from '@/lib/intel/citizen-gate';
import PrecursorAnalogsWorkspace from '@/components/intel/workspaces/precursorAnalogs/PrecursorAnalogsWorkspace';

export const metadata = { title: 'eYKON · Precursor Analogs' };

export default async function PrecursorAnalogsPage() {
  await citizenInertRedirect('precursor-analogs');
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
