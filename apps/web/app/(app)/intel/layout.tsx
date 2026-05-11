import { IntelShell } from '@/components/intel/shell/IntelShell';
import { getCurrentTier } from '@/lib/subscription';

/**
 * Server-side wrapper for the Intelligence Center. Runs once per page
 * load and threads the viewer tier into IntelShell so client UI can
 * branch on Citizen-vs-Pro (e.g. inert workspace tiles vs. live ones).
 *
 * Per the trial-mechanism brief §5.2, Citizens are no longer 403'd at
 * the layout — they see the IntelShell with one live workspace
 * (Calibration Ledger) and eight visible-but-inert tiles. Per-workspace
 * pages call `citizenInertRedirect` from lib/intel/citizen-gate.ts to
 * route Citizens to /pricing if they deep-link to an inert workspace.
 *
 * When NEXT_PUBLIC_AUTH_ENABLED is still 'false' (dev), getCurrentTier()
 * returns 'pro' and the shell renders normally.
 */
export default async function IntelLayout({ children }: { children: React.ReactNode }) {
  const tier = await getCurrentTier();
  return <IntelShell viewerTier={tier}>{children}</IntelShell>;
}
