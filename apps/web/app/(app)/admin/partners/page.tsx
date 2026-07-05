import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import TopNav from '@/components/TopNav';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  FOUNDING_PARTNER_CAP,
  CURRENT_TERMS_VERSION,
  type PartnerStatus,
} from '@/lib/comm/foundingPartner';
import PartnerAdmin from './PartnerAdmin';

export const metadata: Metadata = {
  title: 'Founding Partners — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export type AdminPartnerRow = {
  user_id: string;
  granted_at: string;
  note_deadline: string;
  extended_once: boolean;
  status: PartnerStatus;
  terms_version: string;
  vetting_note: string | null;
  name: string;
  n_resolved: number;
};

export default async function PartnersAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/partners');
  if (!isFounder(user)) redirect('/app');

  const admin = createServerSupabase();
  const { data: partners } = await admin
    .from('founding_partners')
    .select('user_id, granted_at, note_deadline, extended_once, status, terms_version, vetting_note')
    .order('granted_at', { ascending: true });
  const rows = (partners ?? []) as Omit<AdminPartnerRow, 'name' | 'n_resolved'>[];

  // Hydrate names + resolved-call progress (service-role reads).
  const ids = rows.map(r => r.user_id);
  const [profiles, reps] = await Promise.all([
    ids.length
      ? admin.from('user_profiles').select('id, display_name, handle').in('id', ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? admin
          .from('user_reputation')
          .select('author_id, n_resolved')
          .eq('feature', '_all')
          .in('author_id', ids)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map(
    ((profiles.data ?? []) as { id: string; display_name: string | null; handle: string | null }[]).map(p => [
      p.id,
      p.display_name || (p.handle ? `@${p.handle}` : p.id.slice(0, 8)),
    ]),
  );
  const resolvedById = new Map(
    ((reps.data ?? []) as { author_id: string; n_resolved: number | null }[]).map(r => [
      r.author_id,
      r.n_resolved ?? 0,
    ]),
  );
  const hydrated: AdminPartnerRow[] = rows.map(r => ({
    ...r,
    name: nameById.get(r.user_id) ?? r.user_id.slice(0, 8),
    n_resolved: resolvedById.get(r.user_id) ?? 0,
  }));

  return (
    <>
      <TopNav />
      <section style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Admin · Founding Partners ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 6 }}>
          Founding Partners ({hydrated.length} of {FOUNDING_PARTNER_CAP})
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 24, maxWidth: 640 }}>
          Founder-vetted, admin-issued only. A grant bundles Creator Pro (shared free-50 pool) and
          starts the 6-month Reputation-Note clock (shown Note = 10 resolved + skill ≥ 0; the
          percentile term never applies to the deadline). Terms {CURRENT_TERMS_VERSION}.
        </p>
        <PartnerAdmin partners={hydrated} capReached={hydrated.length >= FOUNDING_PARTNER_CAP} />
      </section>
    </>
  );
}
