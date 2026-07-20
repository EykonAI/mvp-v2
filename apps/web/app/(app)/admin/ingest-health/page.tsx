import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { probeShardLiveness, type RegionLiveness } from '@/lib/firms/liveness';

// /admin/ingest-health — founder-only. The standing view of FIRMS ingest
// shard health, companion to the Discord alert fired hourly by
// /api/cron/detect-firms-significance.
//
// Why both: the alert tells you the MOMENT something breaks; this page
// answers "is everything fine right now?" whenever you think to ask,
// without reading a channel backlog. The failure this exists for
// (cron-ingest-firms-na created with no schedule, silent for 43h,
// 2026-07-20) was invisible on every dashboard the platform had.
//
// READ-ONLY by construction: uses probeShardLiveness, never
// checkShardLiveness. Rendering a dashboard must not post alerts or
// advance the re-alert clock — see lib/firms/liveness.ts.

export const metadata: Metadata = {
  title: 'Ingest health — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const TONE: Record<string, { fg: string; label: string }> = {
  ok: { fg: '#2E9E6B', label: 'OK' },
  warn: { fg: '#C98A16', label: 'WARN' },
  critical: { fg: '#D0453B', label: 'CRITICAL' },
};

function ago(hours: number | null): string {
  if (hours === null) return 'never';
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Row({ r }: { r: RegionLiveness }) {
  const tone = TONE[r.severity] ?? TONE.ok;
  return (
    <tr style={{ borderTop: '1px solid var(--rule-soft)' }}>
      <td style={{ padding: '9px 10px', fontFamily: 'var(--f-mono)', fontSize: 12.5 }}>
        {r.region}
      </td>
      <td style={{ padding: '9px 10px' }}>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            color: tone.fg,
            border: `1px solid ${tone.fg}`,
            borderRadius: 4,
            padding: '2px 7px',
          }}
        >
          {tone.label}
        </span>
      </td>
      <td
        style={{
          padding: '9px 10px',
          fontSize: 12.5,
          color: r.severity === 'ok' ? 'var(--ink-dim)' : 'var(--ink)',
        }}
      >
        {ago(r.hoursSinceRun)}
      </td>
      <td
        style={{
          padding: '9px 10px',
          fontFamily: 'var(--f-mono)',
          fontSize: 12,
          color: 'var(--ink-dim)',
        }}
      >
        {r.latestDayCovered ?? '—'}
      </td>
      <td style={{ padding: '9px 10px', fontSize: 12.5, color: 'var(--ink-dim)' }}>
        {r.neverRan ? 'never ingested' : `${r.staleDays}d behind`}
      </td>
    </tr>
  );
}

export default async function IngestHealthPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/ingest-health');
  if (!isFounder(user)) redirect('/app');

  const supabase = createServerSupabase();
  const { regions, errors } = await probeShardLiveness(supabase);

  const bad = regions.filter((r) => r.severity !== 'ok');
  const worst = bad.some((r) => r.severity === 'critical')
    ? 'critical'
    : bad.length > 0
      ? 'warn'
      : 'ok';
  const tone = TONE[worst];

  return (
    <section
      style={{ maxWidth: 900, margin: '0 auto', padding: '56px 32px 120px', color: 'var(--ink)' }}
    >
      <Link
        href="/admin"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          textDecoration: 'none',
        }}
      >
        ← Operator console
      </Link>

      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: '-0.5px',
          margin: '14px 0 0',
        }}
      >
        Ingest health
      </h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: 13.5, marginTop: 8, maxWidth: 660 }}>
        FIRMS thermal shards — the only feed carrying per-run coverage records
        (<code style={{ fontFamily: 'var(--f-mono)' }}>firms_ingest_runs</code>), so the only one
        whose liveness can be stated rather than guessed. Other feeds are not shown here rather
        than shown as healthy.
      </p>

      <div
        style={{
          margin: '22px 0 8px',
          padding: '13px 16px',
          border: `1px solid ${tone.fg}`,
          borderRadius: 8,
          background: 'var(--bg-panel)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: tone.fg }}>
          {tone.label}
        </span>
        <span style={{ fontSize: 13.5 }}>
          {worst === 'ok'
            ? `All ${regions.length} shards ingesting normally.`
            : `${bad.length} of ${regions.length} shards need attention: ${bad
                .map((r) => r.region)
                .join(', ')}.`}
        </span>
      </div>

      {errors.length > 0 && (
        <p style={{ color: '#D0453B', fontSize: 12.5, fontFamily: 'var(--f-mono)' }}>
          probe error: {errors.join(' · ')}
        </p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
        <thead>
          <tr>
            {['Shard', 'State', 'Last run', 'Newest day covered', 'Coverage'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: 'left',
                  padding: '0 10px 8px',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--teal)',
                  fontWeight: 400,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...regions]
            .sort((a, b) => {
              const rank = { critical: 0, warn: 1, ok: 2 } as const;
              return rank[a.severity] - rank[b.severity] || a.region.localeCompare(b.region);
            })
            .map((r) => (
              <Row key={r.region} r={r} />
            ))}
        </tbody>
      </table>

      <div
        style={{
          marginTop: 26,
          padding: '14px 16px',
          border: '1px solid var(--rule-soft)',
          borderRadius: 8,
          fontSize: 12.5,
          lineHeight: 1.6,
          color: 'var(--ink-dim)',
        }}
      >
        <strong style={{ color: 'var(--ink)' }}>Reading this page.</strong>{' '}
        <span style={{ color: TONE.warn.fg }}>WARN</span> = the shard has stopped running; the data
        is still fully recoverable, so re-run it.{' '}
        <span style={{ color: TONE.critical.fg }}>CRITICAL</span> = its newest covered day is 2+
        days behind, meaning the oldest missing day is leaving the trailing 2-day FIRMS NRT window
        and is about to become <em>permanently</em> unrecoverable — which would put a hole in the
        coverage record that <code style={{ fontFamily: 'var(--f-mono)' }}>went_dark</code> depends
        on.
        <br />
        <br />
        <strong style={{ color: 'var(--ink)' }}>To repair a shard:</strong> re-run it with{' '}
        <code style={{ fontFamily: 'var(--f-mono)' }}>
          POST /api/cron/ingest-firms?region=&lt;slug&gt;
        </code>{' '}
        (Bearer CRON_SECRET), then check the Railway service actually has a Cron Schedule — a
        service with none shows &ldquo;Completed&rdquo; and never fires again.
      </div>
    </section>
  );
}
