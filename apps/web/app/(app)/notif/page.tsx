import TopNav from '@/components/TopNav';
import { UpgradePrompt } from '@/components/paywall/UpgradePrompt';
import { getCurrentTier, tierMeetsRequirement } from '@/lib/subscription';
import { NotifShell } from './NotifShell';

// Server-side gate for the Notification Center. Same pattern as
// /intel/layout.tsx — the tier check runs before the shell mounts so
// Citizen tier never reaches the client chrome at all.
//
//   • Pro / Desk / Enterprise → NotifShell (TopNav, side chat panel,
//     persona selector, suggestion library, rules list).
//   • Citizen → UpgradePrompt pointing to /pricing.
//   • Unauthenticated never reaches here; middleware redirects to
//     /auth/signin first (when NEXT_PUBLIC_AUTH_ENABLED=true).
//
// The query param ?filter=recent is consumed inside NotifShell — see
// the bell-glyph deep link in TopNav.

interface NotifPageProps {
  searchParams: { filter?: string };
}

export default async function NotifPage({ searchParams }: NotifPageProps) {
  const tier = await getCurrentTier();

  if (!tierMeetsRequirement(tier, 'pro')) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-void)' }}>
        <TopNav />
        <UpgradePrompt
          requiredTier="pro"
          currentTier={tier}
          moduleLabel="The Notification Center"
          contextLine="Personalised event-driven alerts across email, SMS, and WhatsApp — three rule types, persona-aware suggestions, full audit log."
        />
      </div>
    );
  }

  const recentFilter = searchParams.filter === 'recent';
  return <NotifShell recentFilter={recentFilter} />;
}
