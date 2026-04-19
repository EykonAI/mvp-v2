'use client';
import ComingSoonPanel from '@/components/intel/shell/ComingSoonPanel';

export default function RegimeShiftsWorkspace() {
  return (
    <ComingSoonPanel
      phase="Phase 6 · Analytical workspaces"
      description="Regime Change Detector. Pinned theatres + top-5 by conflict volume → trailing 30d vs preceding 60d histograms per region + KS-test p-values + per-signal shift table (vessel count, flight count, ACLED event count, energy flow MW). Lands in Phase 6 driven by a nightly batch."
    />
  );
}
