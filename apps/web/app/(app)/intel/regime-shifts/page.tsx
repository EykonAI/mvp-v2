import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import RegimeShiftsWorkspace from '@/components/intel/workspaces/regimeShifts/RegimeShiftsWorkspace';

export const metadata = { title: 'eYKON · Regime Shifts' };

export default function RegimeShiftsPage() {
  return (
    <WorkspaceShell
      accent="var(--amber)"
      eyebrow="Analytics · Regime Change"
      title="Regime Change Detector"
      subtitle="Feature 25 · KS-test on 30d vs 60d windows"
    >
      <RegimeShiftsWorkspace />
    </WorkspaceShell>
  );
}
