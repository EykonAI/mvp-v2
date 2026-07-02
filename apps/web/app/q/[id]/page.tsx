import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { createServerSupabase } from '@/lib/supabase-server';

// Public, unauthenticated view of a proactive content post (/q/[id]) — the
// landing page the daily content engine links to. A cold reader gets the
// question, the sourced analyst answer, the feeds used, and a signup CTA, with
// NO login wall. Top-level route (outside the (app) group and not in the
// middleware APP_PATHS list), so it is public by construction — same as /c/[id].
// Data is read with the service-role client (newsjack_events is RLS-locked).

export const dynamic = 'force-dynamic';

const SIGNUP = '/auth/signin?next=/app';

interface ContentEvidence {
  format?: string;
  title?: string;
  question?: string;
  answer?: string;
  hook?: string;
  sources?: string[];
  feeds?: string[];
}

async function loadPost(id: string): Promise<{ ev: ContentEvidence; createdAt: string } | null> {
  // Guard: only well-formed UUIDs reach the DB.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const supabase = createServerSupabase();
    const { data } = await supabase
      .from('newsjack_events')
      .select('evidence, created_at, source, status')
      .eq('id', id)
      .eq('source', 'proactive')
      .maybeSingle();
    if (!data) return null;
    const row = data as { evidence: ContentEvidence | null; created_at: string; status: string };
    if (row.status === 'blocked' || !row.evidence?.answer) return null;
    return { ev: row.evidence, createdAt: row.created_at };
  } catch {
    return null;
  }
}

const FORMAT_LABEL: Record<string, string> = {
  analyst_query: 'Analyst query',
  data_snapshot: 'Data snapshot',
  myth_check: 'Myth check',
  base_rate: 'Base rate',
  entity_deep_cut: 'Entity deep-cut',
  calibration_retro: 'Calibration',
};

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const post = await loadPost(params.id);
  if (!post) return { title: 'eYKON.ai' };
  const title = post.ev.title || 'Intelligence read';
  const desc = (post.ev.answer || '').slice(0, 180);
  return {
    title: `${title} · eYKON.ai`,
    description: desc,
    openGraph: { title, description: desc, siteName: 'eYKON.ai', type: 'article' },
    twitter: { card: 'summary_large_image', title, description: desc },
  };
}

const eyebrow: CSSProperties = { fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)' };

export default async function PublicContentPage({ params }: { params: { id: string } }) {
  const post = await loadPost(params.id);
  if (!post) notFound();
  const { ev } = post;

  return (
    <main style={{ minHeight: '100vh', color: 'var(--ink)' }}>
      <header style={{ borderBottom: '1px solid var(--rule-soft)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" prefetch={false} style={{ textDecoration: 'none', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 18, letterSpacing: '0.04em', color: 'var(--ink)' }}>eYKON</span>
          <span style={{ ...eyebrow, color: 'var(--teal)' }}>·ai</span>
        </Link>
        <Link href={SIGNUP} prefetch={false} style={{ ...eyebrow, color: 'var(--teal)', textDecoration: 'none', border: '1px solid var(--teal)', borderRadius: 4, padding: '7px 14px' }}>
          Explore the live globe
        </Link>
      </header>

      <section style={{ maxWidth: 640, margin: '0 auto', padding: '36px 24px 96px' }}>
        <div style={{ ...eyebrow, color: 'var(--teal)' }}>·· {FORMAT_LABEL[ev.format ?? ''] ?? 'Intelligence read'} ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 25, margin: '16px 0 18px', color: 'var(--ink)', lineHeight: 1.25 }}>{ev.title ?? 'Intelligence read'}</h1>

        {ev.question && (
          <div style={{ borderLeft: '2px solid var(--rule)', paddingLeft: 14, margin: '0 0 18px' }}>
            <div style={{ ...eyebrow, marginBottom: 6 }}>Question to the eYKON analyst</div>
            <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', lineHeight: 1.6, margin: 0 }}>{ev.question}</p>
          </div>
        )}

        <p style={{ fontSize: 15.5, color: 'var(--ink)', lineHeight: 1.7, margin: '0 0 20px' }}>{ev.answer}</p>

        {Array.isArray(ev.sources) && ev.sources.length > 0 && (
          <div style={{ ...eyebrow, marginBottom: 24 }}>Sources: {ev.sources.join(' · ')}</div>
        )}

        {ev.hook && (
          <p style={{ fontSize: 14, color: 'var(--ink)', fontStyle: 'italic', margin: '0 0 26px' }}>{ev.hook}</p>
        )}

        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: '20px 22px', background: 'var(--bg-panel)' }}>
          <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', lineHeight: 1.6, margin: '0 0 14px' }}>
            eYKON fuses maritime, aviation, conflict and energy feeds on one globe, with an AI analyst that cites its sources and a calibration ledger that scores its own predictions. This read was generated from live open-source data.
          </p>
          <Link href={SIGNUP} prefetch={false} style={{ display: 'inline-block', fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--bg-void, #0a0e12)', background: 'var(--teal)', borderRadius: 4, padding: '10px 18px', textDecoration: 'none', fontWeight: 600 }}>
            Ask your own question — free
          </Link>
        </div>

        <p style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 22, lineHeight: 1.6 }}>
          eYKON.ai · geopolitical intelligence. <Link href="/pricing" prefetch={false} style={{ color: 'var(--ink-dim)' }}>Pricing</Link>
        </p>
      </section>
    </main>
  );
}
