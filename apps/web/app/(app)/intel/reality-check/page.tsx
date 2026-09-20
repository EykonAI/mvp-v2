import WorkspaceShell from '@/components/intel/shell/WorkspaceShell';
import { citizenInertRedirect } from '@/lib/intel/citizen-gate';
import RealityCheckWorkspace from '@/components/intel/workspaces/realityCheck/RealityCheckWorkspace';

export const metadata = { title: 'eYKON · Reality Check' };

// The board reads a frozen tick through one accessor, and the switcher keeps
// its state in the URL. Both need the request, so the page is never
// statically rendered.
export const dynamic = 'force-dynamic';

/**
 * INTEL workspace 10 — Reality Check (build prompt §3.3, decision 6).
 *
 * Of everything that looks broken this week, which ones actually are? Each
 * watched site is scored against its OWN baseline on two physically
 * independent measurements, and the refusals are the product.
 *
 * Tier: Pro (D-12). The page gate below sends Citizen and Member to pricing;
 * the API route runs the same check server-side, because a page redirect
 * protects the view and an open API protects nothing.
 */
export default async function RealityCheckPage() {
  await citizenInertRedirect('reality-check');
  return (
    <WorkspaceShell
      accent="var(--green)"
      eyebrow="Refutation · Reality Check"
      title="Reality Check"
      subtitle="Weekly · the refusals are the product"
    >
      <RealityCheckWorkspace />
    </WorkspaceShell>
  );
}
