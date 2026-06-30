import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { BriefsChrome } from './BriefsChrome';

// BRIEFS — the sixth pillar. Reading room for everything eYKON issues to a
// user (briefs, forecasts + scores, the convergence wire). NOTIF stays
// alerts-only; the editorial surfaces read here. Auth here, chrome in
// BriefsChrome, content in each page.

export const metadata: Metadata = {
  title: 'Briefs — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function BriefsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/briefs');
  return <BriefsChrome>{children}</BriefsChrome>;
}
