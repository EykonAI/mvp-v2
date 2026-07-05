import { redirect } from 'next/navigation';
import { getCurrentTier } from '@/lib/subscription';
import { isCitizenInert, type ModuleSlug } from '@/lib/intel/modules';

// Server-side helper for per-workspace page files. If the viewer is a
// Citizen or a Member and the slug is one of the eight inert
// workspaces, redirect to /pricing?from=intel_<slug>. Otherwise no-op,
// the page renders normally.
//
// Member is gated exactly like Citizen here on purpose (monetisation
// review §4.1: Member = participate fully, Pro = analyse
// professionally — the INTEL workspaces stay the reason to upgrade).
//
// Calibration is the one live preview workspace and is exempted from
// this redirect (Citizens/Members see it read-only via the normal
// Calibration page). All other /intel/<slug>/page.tsx files should
// call this helper at the top of their default export.
const INERT_TIERS: ReadonlySet<string> = new Set(['citizen', 'member']);

export async function citizenInertRedirect(slug: ModuleSlug): Promise<void> {
  const tier = await getCurrentTier();
  if (INERT_TIERS.has(tier) && isCitizenInert(slug)) {
    redirect(`/pricing?from=intel_${slug}`);
  }
}
