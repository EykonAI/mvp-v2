import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import CalibrationWorkspace from '@/components/intel/workspaces/calibration/CalibrationWorkspace';

export const metadata = { title: 'eYKON · Calibration Ledger' };

export default function CalibrationPage() {
  return (
    <WorkspaceShell
      accent="var(--teal)"
      eyebrow="Epistemic Anchor · Calibration"
      title="Calibration Ledger"
      subtitle="Feature 22 · Predictions Register + Reliability diagrams"
    >
      <CalibrationWorkspace />
    </WorkspaceShell>
  );
}
