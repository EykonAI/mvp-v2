import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { loadConvergence } from '@/lib/briefs/convergence';
import { MiniMapClient } from '@/components/briefs/MiniMapClient';

// Public, unauthenticated convergence view (/c/[id]). This is the landing page
// the Newsjacking Engine links to: a cold reader from X gets the full sourced
// convergence readout — map, p-value, synthesis, contributing detectors — with
// NO login wall, then a CTA to explore the live product. "Give before you ask."
//
// It lives OUTSIDE the (app) route group on purpose: the (app) layout redirects
// unauthenticated users to /auth/signin, and middleware only gates the APP_PATHS
// list — a top-level /c route is public by construction. Data is read with the
// service-role client (loadConvergence), so anonymous viewers resolve fine.

export const dynamic = 'force-dynamic';

const SIGNUP = (id: string) => `/auth/signin?next=/briefs/convergence/${id}`;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const c = await loadConvergence(params.id);
  if (!c) return { title: 'Convergence — eYKON.ai' };
  const desc = (c.synthesis || `A cross-domain convergence detected at ${c.location}.`).slice(0, 180);
  const title = `Cross-domain convergence — ${c.location}`;
  return {
    title: `${title} · eYKON.ai`,
    description: desc,
    openGraph: { title, description: desc, siteName: 'eYKON.ai', type: 'article' },
    twitter: { card: 'summary_large_image', title, description: desc },
  };
}

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

const eyebrow: CSSProperties = { fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)' };

export default async function PublicConvergencePage({ params }: { params: { id: string } }) {
  const c = await loadConvergence(params.id);
  if (!c) notFound();

  return (
    <main style={{ minHeight: '100vh', color: 'var(--ink)' }}>
      {/* header */}
      <header style={{ borderBottom: '1px solid var(--rule-soft)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" prefetch={false} style={{ textDecoration: 'none', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 18, letterSpacing: '0.04em', color: 'var(--ink)' }}>eYKON</span>
          <span style={{ ...eyebrow, color: 'var(--teal)' }}>·ai</span>
        </Link>
        <Link href={SIGNUP(c.id)} prefetch={false} style={{ ...eyebrow, color: 'var(--teal)', textDecoration: 'none', border: '1px solid var(--teal)', borderRadius: 4, padding: '7px 14px' }}>
          Explore the live globe
        </Link>
      </header>

      <section style={{ maxWidth: 640, margin: '0 auto', padding: '36px 24px 96px' }}>
        <div style={{ ...eyebrow, color: 'var(--teal)' }}>·· Cross-domain convergence ··</div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, margin: '18px 0 4px' }}>
          <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 26, margin: 0, color: 'var(--ink)' }}>{c.location}</h1>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--violet)', whiteSpace: 'nowrap' }}>p &lt; {c.jointPValue.toFixed(3)}</span>
        </div>
        <div style={{ ...eyebrow, marginBottom: 18 }}>{timeAgo(c.createdAt)}</div>

        {c.lat != null && c.lon != null && (
          <div style={{ marginBottom: 18 }}>
            <MiniMapClient lat={c.lat} lon={c.lon} bbox={c.bbox} />
            <p style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-faint)', margin: '6px 0 0' }}>© CARTO · © OpenStreetMap contributors</p>
          </div>
        )}

        {c.synthesis && (
          <p style={{ fontSize: 14.5, color: 'var(--ink)', lineHeight: 1.65, margin: '0 0 22px' }}>{c.synthesis}</p>
        )}

        {c.anomalies.length > 0 && (
          <>
            <div style={{ ...eyebrow, marginBottom: 8 }}>
              {c.anomalies.length} contributing {c.anomalies.length === 1 ? 'anomaly' : 'anomalies'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 30 }}>
              {c.anomalies.map((a, i) => (
                <span key={i} style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px', border: `1px solid ${chipColour(a.domain)}`, color: chipColour(a.domain), borderRadius: 2 }}>
                  {a.label}
                </span>
              ))}
            </div>
          </>
        )}

        {/* conversion band */}
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: '20px 22px', background: 'var(--bg-panel)' }}>
          <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', lineHeight: 1.6, margin: '0 0 14px' }}>
            This is one live signal from eYKON — maritime, aviation, conflict and energy feeds fused on a single globe, with an AI analyst that cites its sources and a calibration ledger that scores its own predictions. Convergences like this fire automatically when independent domains move together in the same place.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href={SIGNUP(c.id)} prefetch={false} style={{ display: 'inline-block', fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--bg-void, #0a0e12)', background: 'var(--teal)', borderRadius: 4, padding: '10px 18px', textDecoration: 'none', fontWeight: 600 }}>
              Explore the live view — free
            </Link>
            {/* Week Pass (mig 075): the impulse exit while an event is
                live — full Pro for 7 days, one-off, expires on its own. */}
            <Link href="/pricing?plan=week_pass" prefetch={false} style={{ display: 'inline-block', fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--teal)', border: '1px solid var(--teal)', borderRadius: 4, padding: '9px 18px', textDecoration: 'none' }}>
              Follow this event with full access — 7-day pass $9
            </Link>
          </div>
        </div>

        <p style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 22, lineHeight: 1.6 }}>
          Detected from open-source data. eYKON.ai · geopolitical intelligence. <Link href="/pricing" prefetch={false} style={{ color: 'var(--ink-dim)' }}>Pricing</Link>
        </p>
      </section>
    </main>
  );
}
