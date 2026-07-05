import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadProfile } from '@/lib/comm/profile';
import { commProfilesEnabled } from '@/lib/flags';
import { createServerSupabase } from '@/lib/supabase-server';
import { isCreatorPro } from '@/lib/comm/creatorPro';
import { getFoundingPartner } from '@/lib/comm/foundingPartner';
import { FoundingPartnerChip } from '@/components/profile/FoundingPartnerEmblem';
import { ReputationNote } from '@/components/profile/ReputationNote';

// Embeddable reputation card (monetisation review §4.3) — a PUBLIC,
// never-authenticated, iframe-able route, top-level like /c and /q
// (outside the (app) group; middleware APP_PATHS does not gate it).
//
// Gating rule, stated precisely: the reputation DATA is public and
// free for everyone — on-platform profiles always show it. What
// Creator Pro gates is THIS distribution surface: the card renders
// fully only for Creator Pro handles; everyone else gets a neutral
// placeholder that links to the (free) on-platform profile. A lapsed
// or absent grant can therefore never hide a track record — only
// un-render this off-platform widget.
//
// The footer backlink carries ?ch=repcard&utm_content=<slug> so every
// click-through lands in channel_touchpoints (PAMS).

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ReputationEmbedPage({
  params,
}: {
  params: { handle: string };
}) {
  if (!commProfilesEnabled()) notFound();
  const data = await loadProfile(params.handle);
  if (!data) notFound();

  const p = data.profile;
  const slug = p.handle ?? p.public_id ?? params.handle;
  const name = p.display_name || (p.handle ? `@${p.handle}` : 'Analyst');
  const admin = createServerSupabase();
  const [pro, partner] = await Promise.all([
    isCreatorPro(admin, p.id),
    getFoundingPartner(admin, p.id),
  ]);

  const wrap: React.CSSProperties = {
    fontFamily: 'var(--f-body, system-ui)',
    background: 'var(--bg-panel, #0c1418)',
    border: '1px solid var(--rule, #24343c)',
    borderRadius: 10,
    padding: '16px 18px',
    color: 'var(--ink, #dce8ec)',
    maxWidth: 420,
    margin: 8,
  };
  const footer: React.CSSProperties = {
    marginTop: 12,
    fontFamily: 'var(--f-mono, monospace)',
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  };

  if (!pro) {
    return (
      <div style={wrap}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim, #8fa3ab)', lineHeight: 1.5, margin: '6px 0 0' }}>
          This analyst’s full track record is free to view on eYKON.
        </p>
        <div style={footer}>
          <a
            href={`/u/${slug}?ch=repcard&utm_content=${encodeURIComponent(slug)}`}
            target="_blank"
            rel="noopener"
            style={{ color: 'var(--teal, #37c0b2)', textDecoration: 'none' }}
          >
            View on eYKON →
          </a>
        </div>
      </div>
    );
  }

  const note = data.reputationNote;
  return (
    <div style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {name}
            {partner && <FoundingPartnerChip />}
          </div>
          <div style={{ fontFamily: 'var(--f-mono, monospace)', fontSize: 10.5, color: 'var(--ink-faint, #5c6f77)', marginTop: 2 }}>
            @{slug} · {data.resolvedCount} resolved call{data.resolvedCount === 1 ? '' : 's'}
          </div>
        </div>
        <ReputationNote
          size="badge"
          note={note?.note ?? null}
          nResolved={note?.nResolved ?? data.resolvedCount}
          percentile={note?.percentile}
          coverage={note?.coverage}
        />
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--ink-dim, #8fa3ab)', lineHeight: 1.5, margin: '10px 0 0' }}>
        Commit-reveal predictions, Brier-scored against the source. Wrong calls stay published.
      </p>
      <div style={footer}>
        <a
          href={`/u/${slug}?ch=repcard&utm_content=${encodeURIComponent(slug)}`}
          target="_blank"
          rel="noopener"
          style={{ color: 'var(--teal, #37c0b2)', textDecoration: 'none' }}
        >
          Provably calibrated — powered by eYKON →
        </a>
      </div>
    </div>
  );
}
