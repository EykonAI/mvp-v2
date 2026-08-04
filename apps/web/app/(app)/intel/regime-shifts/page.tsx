import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import { citizenInertRedirect } from '@/lib/intel/citizen-gate';
import RegimeShiftsWorkspace from '@/components/intel/workspaces/regimeShifts/RegimeShiftsWorkspace';

export const metadata = { title: 'eYKON · Regime Shifts' };

export default async function RegimeShiftsPage() {
  await citizenInertRedirect('regime-shifts');
  return (
    <WorkspaceShell
      accent="var(--amber)"
      eyebrow="Analytics · Regime Change"
      title="Regime Change Detector"
      subtitle="Feature 25 · two-sample KS on trailing 30d vs preceding 60d"
    >
      <RegimeShiftsWorkspace />
    </WorkspaceShell>
  );
}
