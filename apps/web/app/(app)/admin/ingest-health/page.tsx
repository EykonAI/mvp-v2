import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { probeShardLiveness, type RegionLiveness } from '@/lib/firms/liveness';
import { probeFeedHealth, SEVERITY_RANK, type FeedHealth } from '@/lib/monitoring/feed-health';

// /admin/ingest-health — founder-only. The standing view of ingest health:
//   • Live data feeds (AIS / GDELT / ADS-B) — freshness of max(ingested_at)
//   • Thermal shards (FIRMS) — per-run coverage from firms_ingest_runs
//
// Companion to the Discord alert fired hourly for FIRMS shards. The two feed
// mechanisms differ on purpose (see lib/monitoring/feed-health.ts): shards
// need per-run coverage records; feeds just need "is fresh data landing?".
//
// READ-ONLY by construction: both probes are pure reads. Rendering a
// dashboard must never post an alert or advance a re-alert clock.

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

function Badge({ severity }: { severity: string }) {
  const tone = TONE[severity] ?? TONE.ok;
  return (
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
  );
}

const TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '0 10px 8px',
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--teal)',
  fontWeight: 400,
};
const TD: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5 };

function FeedRow({ f }: { f: FeedHealth }) {
  return (
    <tr style={{ borderTop: '1px solid var(--rule-soft)' }}>
      <td style={{ ...TD, fontFamily: 'var(--f-mono)' }}>{f.label}</td>
      <td style={TD}>
        <Badge severity={f.severity} />
      </td>
      <td style={{ ...TD, color: f.severity === 'ok' ? 'var(--ink-dim)' : 'var(--ink)' }}>
        {ago(f.hoursStale)}
      </td>
      <td style={{ ...TD, color: 'var(--ink-dim)' }}>{f.source}</td>
    </tr>
  );
}

function ShardRow({ r }: { r: RegionLiveness }) {
  return (
    <tr style={{ borderTop: '1px solid var(--rule-soft)' }}>
      <td style={{ ...TD, fontFamily: 'var(--f-mono)' }}>{r.region}</td>
      <td style={TD}>
        <Badge severity={r.severity} />
      </td>
      <td style={{ ...TD, color: r.severity === 'ok' ? 'var(--ink-dim)' : 'var(--ink)' }}>
        {ago(r.hoursSinceRun)}
      </td>
      <td style={{ ...TD, fontFamily: 'var(--f-mono)', color: 'var(--ink-dim)' }}>
        {r.latestDayCovered ?? '—'}
      </td>
      <td style={{ ...TD, color: 'var(--ink-dim)' }}>
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
  const [{ feeds, errors: feedErrors }, { regions, errors: shardErrors }] = await Promise.all([
    probeFeedHealth(supabase),
    probeShardLiveness(supabase),
  ]);

  const errors = [...feedErrors, ...shardErrors];
  const allSeverities = [...feeds.map((f) => f.severity), ...regions.map((r) => r.severity)];
  const worst = allSeverities.includes('critical')
    ? 'critical'
    : allSeverities.includes('warn')
      ? 'warn'
      : 'ok';
  const tone = TONE[worst];
  const badCount = allSeverities.filter((s) => s !== 'ok').length;

  const sortedFeeds = [...feeds].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const sortedShards = [...regions].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.region.localeCompare(b.region),
  );

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
      <p style={{ color: 'var(--ink-dim)', fontSize: 13.5, marginTop: 8, maxWidth: 680 }}>
        Two questions, two mechanisms. <strong>Live feeds</strong> answer &ldquo;is fresh data still
        landing?&rdquo; from <code style={{ fontFamily: 'var(--f-mono)' }}>max(ingested_at)</code> on
        the table each writes. <strong>Thermal shards</strong> answer &ldquo;was each region
        watched?&rdquo; from per-run coverage records. A green cron or an &ldquo;Online&rdquo; worker
        is never proof on its own — this reads the data itself.
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
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: tone.fg }}>{tone.label}</span>
        <span style={{ fontSize: 13.5 }}>
          {worst === 'ok'
            ? `All ${feeds.length} feeds and ${regions.length} shards healthy.`
            : `${badCount} of ${feeds.length + regions.length} ingest paths need attention.`}
        </span>
      </div>

      {errors.length > 0 && (
        <p style={{ color: '#D0453B', fontSize: 12.5, fontFamily: 'var(--f-mono)' }}>
          probe error: {errors.join(' · ')}
        </p>
      )}

      {/* ── Live data feeds ─────────────────────────────────────── */}
      <h2
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          margin: '26px 0 6px',
        }}
      >
        Live data feeds
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Feed', 'State', 'Last ingest', 'Source (fix here)'].map((h) => (
              <th key={h} style={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedFeeds.map((f) => (
            <FeedRow key={f.key} f={f} />
          ))}
        </tbody>
      </table>

      {/* ── Thermal shards (FIRMS) ──────────────────────────────── */}
      <h2
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          margin: '30px 0 6px',
        }}
      >
        Thermal shards (FIRMS)
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Shard', 'State', 'Last run', 'Newest day covered', 'Coverage'].map((h) => (
              <th key={h} style={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedShards.map((r) => (
            <ShardRow key={r.region} r={r} />
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
        <span style={{ color: TONE.warn.fg }}>WARN</span> = getting stale, check it;{' '}
        <span style={{ color: TONE.critical.fg }}>CRITICAL</span> = unambiguously broken. Feed
        thresholds match each feed&rsquo;s normal cadence (ADS-B tight, AIS loose). For a shard,
        CRITICAL additionally means its oldest missing day is leaving the 2-day FIRMS window and is
        about to become <em>permanently</em> unrecoverable.
        <br />
        <br />
        <strong style={{ color: 'var(--ink)' }}>Alerting.</strong> FIRMS shards also ping Discord
        hourly. Live feeds are page-only for now (thresholds are still being watched against real
        cadence) — wiring them to the same webhook is the intended next step once the numbers here
        prove stable.
        <br />
        <br />
        <strong style={{ color: 'var(--ink)' }}>To repair a shard:</strong>{' '}
        <code style={{ fontFamily: 'var(--f-mono)' }}>
          POST /api/cron/ingest-firms?region=&lt;slug&gt;
        </code>{' '}
        (Bearer CRON_SECRET), then check the Railway service has a Cron Schedule — one with none
        shows &ldquo;Completed&rdquo; and never fires again.
      </div>
    </section>
  );
}
