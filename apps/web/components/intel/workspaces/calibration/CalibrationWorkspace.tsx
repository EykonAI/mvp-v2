'use client';
import ComingSoonPanel from '@/components/intel/shell/ComingSoonPanel';

export default function CalibrationWorkspace() {
  return (
    <ComingSoonPanel
      phase="Phase 6 · Calibration Ledger"
      description="Full calibration ledger. Methodology note + per-persona reliability diagrams (Analyst, Day Trader, Commodities) + performance table (count/Brier/log-loss/calibration slope across 7d/30d/90d windows) + per-feature drill-down browser of individual predictions. Lands in Phase 6 once the Prediction Register is live from Phase 2 + scoring cron from Phase 7."
    />
  );
}
