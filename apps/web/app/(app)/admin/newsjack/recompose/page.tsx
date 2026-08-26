import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import Runner from './Runner';

export const metadata: Metadata = {
  title: 'Newsjack recompose (dry run) — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function RecomposePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/newsjack/recompose');
  if (!isFounder(user)) redirect('/app');

  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
      <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Admin · Newsjack recompose ··</div>
      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>
        Dry-run recompose
      </h1>
      <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 10, maxWidth: 720 }}>
        Runs existing X drafts back through the copywriting agent and shows both versions. No draft is
        created or changed — the queue on{' '}
        <Link href="/admin/newsjack" style={{ color: 'var(--teal)' }}>
          /admin/newsjack
        </Link>{' '}
        is untouched, and no recomposed thread can be approved from here. The one thing it does write
        is its own cost: each composition records a row in the cost ledger, because the spend is real.
      </p>
      <p style={{ fontSize: 13, color: 'var(--amber)', marginBottom: 24, maxWidth: 720 }}>
        Read the output as writing samples, not as posts. A newsjack window is 15–60 minutes, and
        rewriting the copy does not refresh the evidence underneath it — an old draft recomposed
        beautifully is still an old draft. Every row says how old it is. Blocked events are excluded
        entirely: most were blocked for having no sourced insight, which is a gap in the evidence that
        no writer can close.
      </p>

      <Runner />
    </section>
  );
}
