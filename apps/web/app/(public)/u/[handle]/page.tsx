import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { commProfilesEnabled } from '@/lib/flags';
import { loadProfile, isFollowing, type ProfilePrediction, type ProfileLink } from '@/lib/comm/profile';
import { personaLabel } from '@/lib/intelligence-analyst/personas';
import { ReputationPassport } from '@/components/profile/ReputationPassport';
import { Wall } from '@/components/profile/Wall';
import { FollowButton } from '@/components/profile/FollowButton';
import { ShareButton } from '@/components/profile/ShareButton';
import { getCurrentUser } from '@/lib/auth/session';

// /u/<handle> — public, read-only COMM profile (Phase 1 of the COMM
// User Profile Page brief). The home of the Calibration Passport and the
// conversion landing when a visitor arrives from a shared card. Gated by
// COMM_PROFILES_ENABLED; reads only the public_profiles view. Reputation
// scoring arrives with the §9 engine — until then the passport reads
// "calibrating" (never a fabricated number).

export const dynamic = 'force-dynamic';

const TABS = ['predictions', 'wall', 'spaces', 'about'] as const;
type Tab = (typeof TABS)[number];

type SearchParams = { [key: string]: string | string[] | undefined };

function pickTab(raw: string | string[] | undefined): Tab {
  const value = typeof raw === 'string' ? raw : '';
  return (TABS as readonly string[]).includes(value) ? (value as Tab) : 'predictions';
}

export async function generateMetadata({
  params,
}: {
  params: { handle: string };
}): Promise<Metadata> {
  if (!commProfilesEnabled()) return { robots: { index: false, follow: false } };
  const data = await loadProfile(params.handle);
  if (!data) return { title: 'Profile · eYKON', robots: { index: false, follow: false } };
  const p = data.profile;
  const name = p.display_name || (p.handle ? `@${p.handle}` : 'Analyst');
  const slug = p.handle ?? p.public_id ?? params.handle;
  const description = p.bio || `${name} — geopolitical track record on eYKON.`;
  return {
    title: `${name} · eYKON`,
    description,
    robots: { index: true, follow: true },
    openGraph: { title: `${name} · eYKON`, description, images: [`/u/${slug}/card.png`] },
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: { handle: string };
  searchParams?: SearchParams;
}) {
  if (!commProfilesEnabled()) notFound();
  const data = await loadProfile(params.handle);
  if (!data) notFound();

  const p = data.profile;
  const slug = p.handle ?? p.public_id ?? params.handle;
  const viewer = await getCurrentUser();
  const isOwner = !!viewer && viewer.id === p.id;
  const initialFollowing = viewer && !isOwner ? await isFollowing(viewer.id, p.id) : false;
  const name = p.display_name || (p.handle ? `@${p.handle}` : 'Analyst');
  const tab = pickTab(searchParams?.tab);
  const joined = p.created_at ? new Date(p.created_at).getUTCFullYear() : null;
  const initials = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'EY';

  return (
    <article style={{ maxWidth: 980, margin: '0 auto', padding: '36px 24px 72px' }}>
      {p.cover_url && (
        <div
          style={{
            height: 132,
            borderRadius: 10,
            marginBottom: 20,
            background: `center/cover no-repeat url("${p.cover_url}")`,
            border: '1px solid var(--rule)',
          }}
        />
      )}
      <header style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: '50%',
            flexShrink: 0,
            border: '1px solid var(--rule)',
            background: p.avatar_url
              ? `center/cover no-repeat url("${p.avatar_url}")`
              : 'var(--bg-raised)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--ink-faint)',
            fontFamily: 'var(--f-display)',
            fontSize: 26,
          }}
        >
          {p.avatar_url ? '' : initials}
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <h1
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 24,
              color: 'var(--ink)',
              margin: 0,
              letterSpacing: '0.02em',
            }}
          >
            {name}
          </h1>
          <div
            style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--ink-dim)', marginTop: 4 }}
          >
            {p.handle ? `@${p.handle}` : p.public_id} · pseudonymous
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <Pill>{personaLabel(p.preferred_persona ?? 'analyst')}</Pill>
            {p.is_founding_analyst && <Pill tone="teal">Founding Analyst</Pill>}
            {joined && (
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>
                joined {joined}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          {isOwner ? (
            <Link href="/settings/profile" style={primaryBtn} prefetch={false}>
              Edit profile
            </Link>
          ) : (
            <FollowButton profileId={p.id} isAuthed={!!viewer} initialFollowing={initialFollowing} />
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <ShareButton />
            <SoonChip>Message</SoonChip>
            <SoonChip>Subscribe</SoonChip>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 28, marginTop: 28, flexWrap: 'wrap' }}>
        <aside style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ReputationPassport resolvedCount={data.resolvedCount} reputation={data.reputation} />
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-dim)', lineHeight: 1.8 }}>
            <span style={{ color: 'var(--ink)' }}>{fmtCount(data.followers)}</span> followers ·{' '}
            <span style={{ color: 'var(--ink)' }}>{fmtCount(data.following)}</span> following
            <br />
            {data.resolvedCount} resolved · {data.predictions.length} call
            {data.predictions.length === 1 ? '' : 's'}
            {joined ? ` · joined ${joined}` : ''}
          </div>
        </aside>

        <main style={{ flex: 1, minWidth: 280 }}>
          <nav
            style={{
              display: 'flex',
              gap: 20,
              borderBottom: '1px solid var(--rule)',
              paddingBottom: 0,
            }}
          >
            {TABS.map((t) => (
              <Link
                key={t}
                href={`/u/${slug}?tab=${t}`}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 12,
                  letterSpacing: '0.04em',
                  textTransform: 'capitalize',
                  textDecoration: 'none',
                  color: t === tab ? 'var(--teal)' : 'var(--ink-dim)',
                  borderBottom: t === tab ? '2px solid var(--teal)' : '2px solid transparent',
                  paddingBottom: 10,
                }}
              >
                {t}
              </Link>
            ))}
          </nav>
          <div style={{ marginTop: 18 }}>
            {tab === 'predictions' && <PredictionsTab predictions={data.predictions} />}
            {tab === 'wall' && <Wall initialPosts={data.wall} isOwner={isOwner} />}
            {tab === 'spaces' && (
              <ComingSoon
                title="Spaces"
                note="Free & paid spaces this analyst runs — arriving with the COMM rollout."
              />
            )}
            {tab === 'about' && (
              <AboutTab
                bio={p.bio}
                links={p.links}
                persona={personaLabel(p.preferred_persona ?? 'analyst')}
                joined={joined}
              />
            )}
          </div>
        </main>
      </div>
    </article>
  );
}

const primaryBtn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  border: '1px solid var(--teal-dim)',
  borderRadius: 3,
  padding: '9px 16px',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

function Pill({ children, tone }: { children: ReactNode; tone?: 'teal' }) {
  const teal = tone === 'teal';
  return (
    <span
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.05em',
        padding: '3px 9px',
        borderRadius: 999,
        color: teal ? 'var(--teal)' : 'var(--ink-dim)',
        background: teal ? 'var(--teal-glow)' : 'var(--bg-raised)',
        border: `1px solid ${teal ? 'var(--teal-deep)' : 'var(--rule)'}`,
      }}
    >
      {children}
    </span>
  );
}

function SoonChip({ children }: { children: ReactNode }) {
  return (
    <span
      title="Coming soon"
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.05em',
        padding: '6px 10px',
        borderRadius: 3,
        color: 'var(--ink-faint)',
        border: '1px solid var(--rule-soft)',
        cursor: 'default',
      }}
    >
      {children} <span style={{ opacity: 0.6 }}>soon</span>
    </span>
  );
}

function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div
      style={{
        padding: '28px 20px',
        textAlign: 'center',
        border: '1px dashed var(--rule)',
        borderRadius: 6,
        color: 'var(--ink-faint)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 15,
          color: 'var(--ink-dim)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12 }}>{note}</div>
    </div>
  );
}

function AboutTab({
  bio,
  links,
  persona,
  joined,
}: {
  bio: string | null;
  links: ProfileLink[];
  persona: string;
  joined: number | null;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        fontSize: 13,
        color: 'var(--ink-dim)',
        lineHeight: 1.6,
      }}
    >
      <p style={{ color: bio ? 'var(--ink)' : 'var(--ink-faint)' }}>{bio || 'No bio yet.'}</p>
      <div>
        <span className="eyebrow">Persona</span>
        <div style={{ marginTop: 4, color: 'var(--ink)' }}>{persona}</div>
      </div>
      {links.length > 0 && (
        <div>
          <span className="eyebrow">Links</span>
          <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
            {links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                rel="nofollow noopener noreferrer"
                target="_blank"
                style={{ color: 'var(--teal)', fontFamily: 'var(--f-mono)', fontSize: 12 }}
              >
                {l.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
      {joined && (
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
          Joined {joined}
        </div>
      )}
    </div>
  );
}

function PredictionsTab({ predictions }: { predictions: ProfilePrediction[] }) {
  if (predictions.length === 0) {
    return (
      <div
        style={{
          padding: '28px 20px',
          textAlign: 'center',
          border: '1px dashed var(--rule)',
          borderRadius: 6,
          color: 'var(--ink-faint)',
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        No published predictions yet. When this analyst makes a call it’s sealed, auto-resolved
        against live data, and scored here.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          paddingBottom: 8,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <span style={{ flex: 1 }}>Prediction</span>
        <span style={{ width: 48, textAlign: 'right' }}>p</span>
        <span style={{ width: 92, textAlign: 'right' }}>Outcome</span>
        <span style={{ width: 64, textAlign: 'right' }}>Brier</span>
      </div>
      {predictions.map((pr, i) => (
        <PredictionRowView key={pr.public_id ?? i} p={pr} />
      ))}
    </div>
  );
}

function PredictionRowView({ p }: { p: ProfilePrediction }) {
  const resolved = p.status === 'resolved' && p.observed_value != null && p.predicted_mean != null;
  const correct = resolved
    ? Math.abs((p.predicted_mean as number) - (p.observed_value as number)) <
      Math.abs(1 - (p.predicted_mean as number) - (p.observed_value as number))
    : false;
  const dot = !resolved ? 'var(--ink-faint)' : correct ? 'var(--green)' : 'var(--red)';
  const label = !resolved ? 'OPEN' : correct ? 'WIN' : 'MISS';
  const color = !resolved ? 'var(--ink-faint)' : correct ? 'var(--green)' : 'var(--red)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '11px 0',
        borderBottom: '1px solid var(--rule-soft)',
        fontSize: 12.5,
        color: 'var(--ink)',
      }}
    >
      <span style={{ flex: 1, paddingRight: 10 }}>{p.statement ?? '—'}</span>
      <span
        style={{ width: 48, textAlign: 'right', fontFamily: 'var(--f-mono)', color: 'var(--ink-dim)' }}
      >
        {p.predicted_mean == null ? '—' : p.predicted_mean.toFixed(2)}
      </span>
      <span
        style={{
          width: 92,
          textAlign: 'right',
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          color,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: dot,
            marginRight: 6,
          }}
        />
        {label}
      </span>
      <span
        style={{ width: 64, textAlign: 'right', fontFamily: 'var(--f-mono)', color: 'var(--ink-dim)' }}
      >
        {p.brier == null ? '—' : p.brier.toFixed(3)}
      </span>
    </div>
  );
}

function fmtCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
