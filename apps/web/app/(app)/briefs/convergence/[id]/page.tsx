import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { loadConvergence } from '@/lib/briefs/convergence';
import { MiniMapClient } from '@/components/briefs/MiniMapClient';

// Per-convergence drill-down: the synthesis, the contributing anomalies, the
// joint p-value, and a locator mini-map from the event's bounding box.

export const dynamic = 'force-dynamic';

const backLink: CSSProperties = { fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)', textDecoration: 'none' };

function chipColour(domain: string): string {
  switch (domain) {
    case 'maritime': return 'var(--teal)';
    case 'air_traffic': return 'var(--amber)';
    case 'conflict': return 'var(--red)';
    case 'energy': return 'var(--green)';
    default: return 'var(--ink-faint)';
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function ConvergenceDetailPage({ params }: { params: { id: string } }) {
  const c = await loadConvergence(params.id);
  if (!c) notFound();

  return (
    <div>
      <Link href="/briefs/convergence" prefetch={false} style={backLink}>
        ← Convergence
      </Link>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, margin: '16px 0 4px' }}>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
          Convergence
        </span>
        <span className="num-lg" style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--violet)' }}>
          p &lt; {c.jointPValue.toFixed(3)}
        </span>
      </div>

      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 22, margin: '0 0 2px', color: 'var(--ink)' }}>{c.location}</h1>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
        {timeAgo(c.createdAt)}
      </div>

      {c.lat != null && c.lon != null && (
        <div style={{ marginBottom: 18 }}>
          <MiniMapClient lat={c.lat} lon={c.lon} bbox={c.bbox} />
          <p style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-faint)', margin: '6px 0 0' }}>
            © CARTO · © OpenStreetMap contributors
          </p>
        </div>
      )}

      {c.synthesis && (
        <p style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6, margin: '0 0 20px' }}>{c.synthesis}</p>
      )}

      {c.anomalies.length > 0 && (
        <>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 8 }}>
            {c.anomalies.length} contributing {c.anomalies.length === 1 ? 'anomaly' : 'anomalies'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {c.anomalies.map((a, i) => (
              <span
                key={i}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  border: `1px solid ${chipColour(a.domain)}`,
                  color: chipColour(a.domain),
                  borderRadius: 2,
                }}
              >
                {a.label}
              </span>
            ))}
          </div>
        </>
      )}

      <p style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-dim)', marginTop: 24, lineHeight: 1.6 }}>
        To be alerted when a convergence fires near your watchlist, set a rule in{' '}
        <Link href="/notif" prefetch={false} style={{ color: 'var(--teal)', textDecoration: 'none' }}>
          NOTIF
        </Link>
        .
      </p>
    </div>
  );
}
