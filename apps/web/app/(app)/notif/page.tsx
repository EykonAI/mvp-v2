import { getCurrentTier } from '@/lib/subscription';
import { getServerSupabase } from '@/lib/auth/session';
import { getFeedHealth } from '@/lib/notifications/feed-health';
import { computeHiddenSuggestionIds } from '@/lib/notifications/suggestion-library';
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
//
// Honesty-pass v2: we probe per-bucket feed health here and pass
// the set of suggestion ids whose required feeds are empty/stale
// down to NotifShell. NotifShell skips those cards when rendering, so
// the library self-heals the moment a feed comes back online. The
// probe is memoised 5 min in-process; fail-open on any error.

interface NotifPageProps {
  searchParams: { filter?: string };
}

export default async function NotifPage({ searchParams }: NotifPageProps) {
  const tier = await getCurrentTier();
  const recentFilter = searchParams.filter === 'recent';
  const supabase = getServerSupabase();
  const feedHealth = await getFeedHealth(supabase);
  const hiddenSuggestionIds = computeHiddenSuggestionIds(feedHealth);
  return (
    <NotifShell
      recentFilter={recentFilter}
      viewerTier={tier}
      hiddenSuggestionIds={hiddenSuggestionIds}
    />
  );
}
