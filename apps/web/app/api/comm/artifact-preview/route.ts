import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getCurrentTier } from '@/lib/subscription';
import { loadConvergence } from '@/lib/briefs/convergence';
import type { ArtifactPreview } from '@/lib/comm/embeds';

// Preview data for in-Space artifact cards (monetisation review §4.2).
// Reads the SAME public data the /c/[id] and /q/[id] no-login pages
// serve, so nothing here widens what a reader could already see. The
// CTA is tier-aware: Citizens get the upgrade hook (?from=space_embed →
// channel_touchpoints via PAMS); paying tiers get no upsell.

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind');
  const id = (req.nextUrl.searchParams.get('id') ?? '').toLowerCase();
  if ((kind !== 'c' && kind !== 'q') || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid artifact ref' }, { status: 400 });
  }

  const tier = await getCurrentTier();
  const cta =
    tier === 'citizen'
      ? { href: '/pricing?from=space_embed', label: 'Track this yourself →' }
      : null;

  if (kind === 'c') {
    const conv = await loadConvergence(id);
    if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const preview: ArtifactPreview = {
      kind,
      id,
      href: `/c/${id}`,
      badge: `Convergence · p ${conv.jointPValue.toFixed(2)}`,
      title: conv.location,
      excerpt: truncate(conv.synthesis, 180),
      createdAt: conv.createdAt ?? null,
      cta,
    };
    return NextResponse.json(preview);
  }

  // kind === 'q' — proactive-content page, same read as /q/[id].
  const admin = createServerSupabase();
  const { data, error } = await admin
    .from('newsjack_events')
    .select('evidence, created_at, source, status')
    .eq('id', id)
    .eq('source', 'proactive')
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ev = (data.evidence ?? {}) as { title?: string; question?: string; answer?: string; format?: string };
  const preview: ArtifactPreview = {
    kind,
    id,
    href: `/q/${id}`,
    badge: 'eYKON Analyst',
    title: ev.title || ev.question || 'Analyst question',
    excerpt: truncate(ev.answer ?? '', 180),
    createdAt: data.created_at ?? null,
    cta,
  };
  return NextResponse.json(preview);
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}
