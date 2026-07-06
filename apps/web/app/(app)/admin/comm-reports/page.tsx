import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';

export const metadata: Metadata = { title: 'COMM reports — eYKON.ai', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  status: string;
  created_at: string;
}

export default async function CommReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/comm-reports');
  if (!isFounder(user)) redirect('/app');

  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('comm_reports')
    .select('id, reporter_id, target_type, target_id, reason, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  const reports = (data as ReportRow[] | null) ?? [];

  const ids = Array.from(new Set(reports.map((r) => r.reporter_id)));
  const labels = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase.from('user_profiles').select('id, display_name, email').in('id', ids);
    for (const p of (profs as { id: string; display_name: string | null; email: string | null }[] | null) ?? []) {
      labels.set(p.id, p.display_name || p.email || p.id.slice(0, 8));
    }
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)', borderBottom: '1px solid var(--rule)' };
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: 'var(--ink)', borderBottom: '1px solid var(--rule-soft)', verticalAlign: 'top' };

  return (
    <>
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 80px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· Admin · COMM reports ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 28, marginTop: 8, marginBottom: 20 }}>Reports ({reports.length})</h1>
        {reports.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', border: '1px dashed var(--rule)', borderRadius: 8, color: 'var(--ink-faint)', fontSize: 13 }}>No reports.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Reporter</th>
                <th style={th}>Target</th>
                <th style={th}>Reason</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}>{r.created_at.slice(0, 16).replace('T', ' ')}</td>
                  <td style={td}>{labels.get(r.reporter_id) ?? r.reporter_id.slice(0, 8)}</td>
                  <td style={{ ...td, fontFamily: 'var(--f-mono)', fontSize: 11 }}>{r.target_type}:{r.target_id.slice(0, 8)}</td>
                  <td style={{ ...td, color: 'var(--ink-dim)' }}>{r.reason ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'var(--f-mono)', fontSize: 11, color: r.status === 'open' ? 'var(--amber)' : 'var(--ink-faint)' }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
