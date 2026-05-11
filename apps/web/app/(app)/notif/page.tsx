import { getCurrentTier } from '@/lib/subscription';
import { NotifShell } from './NotifShell';

// Server-side wrapper for the Notification Center.
//
// Per the trial-mechanism brief §5.3, Citizens are no longer 403'd at
// the page level — they reach NotifShell and can browse the suggestion
// library, create one email-only rule (ACTIVE_RULE_LIMITS.citizen=1),
// and receive notifications. Server-side API gates enforce the
// "email-only" + "one rule" constraints; the UI surfaces the limit.
//
// The query param ?filter=recent is consumed inside NotifShell — see
// the bell-glyph deep link in TopNav.

interface NotifPageProps {
  searchParams: { filter?: string };
}

export default async function NotifPage({ searchParams }: NotifPageProps) {
  const tier = await getCurrentTier();
  const recentFilter = searchParams.filter === 'recent';
  return <NotifShell recentFilter={recentFilter} viewerTier={tier} />;
}
