import TopNav from '@/components/TopNav';
import { IntelShell } from '@/components/intel/shell/IntelShell';
import { UpgradePrompt } from '@/components/paywall/UpgradePrompt';
import { getCurrentTier, tierMeetsRequirement } from '@/lib/subscription';

/**
 * Server-side gate for the entire Intelligence Center. Runs the tier check
 * before handing off to the IntelShell client component (TopNav, chat panel,
 * calibration strip, persona provider).
 *
 * When the Phase-A tier check fails:
 *   - Citizen → UpgradePrompt pointing to /pricing
 *   - Unauthenticated (auth-enabled flag true but no session) never reaches
 *     here; middleware redirects to /auth/signin first.
 *
 * When NEXT_PUBLIC_AUTH_ENABLED is still 'false' (dev), getCurrentTier()
 * returns 'pro' and the shell renders normally, so the existing Intelligence
 * Center UX stays explorable during development.
 */
export default async function IntelLayout({ children }: { children: React.ReactNode }) {
  const tier = await getCurrentTier();

  if (!tierMeetsRequirement(tier, 'pro')) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-void)' }}>
        <TopNav />
        <UpgradePrompt
          requiredTier="pro"
          currentTier={tier}
          moduleLabel="The Intelligence Center"
          contextLine="Nine compound-signal workspaces, the AI analyst, and real-time feeds are all included with Pro."
        />
      </div>
    );
  }

  return <IntelShell>{children}</IntelShell>;
}
