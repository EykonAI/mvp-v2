import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { commProfilesEnabled } from '@/lib/flags';
import {
  loadProfile,
  isFollowing,
  type ProfilePrediction,
  type ProfileLink,
  type ProfileSpace,
} from '@/lib/comm/profile';
import { isBlockedByMe } from '@/lib/comm/moderation';
import { personaLabel } from '@/lib/intelligence-analyst/personas';
import { ReputationPassport } from '@/components/profile/ReputationPassport';
import { ReputationNote } from '@/components/profile/ReputationNote';
import { Wall } from '@/components/profile/Wall';
import { FollowButton } from '@/components/profile/FollowButton';
import { ShareButton } from '@/components/profile/ShareButton';
import { MakeACall } from '@/components/profile/MakeACall';
import { MessageButton } from '@/components/profile/MessageButton';
import { ProfileModeration } from '@/components/profile/ProfileModeration';
import { FoundingPartnerEmblem, FoundingPartnerChip } from '@/components/profile/FoundingPartnerEmblem';
import { FirstTenPanel } from '@/components/profile/FirstTenPanel';
import { getFoundingPartner } from '@/lib/comm/foundingPartner';
import {
  loadFastClosingMarkets,
  loadFirmsFacilityTemplates,
  type FastMarket,
  type FirmsTemplate,
} from '@/lib/comm/firstTen';
import { createServerSupabase } from '@/lib/supabase-server';
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
  const viewer = await getCurrentUser();
  const data = await loadProfile(params.handle, viewer?.id);
  if (!data) notFound();

  const p = data.profile;
  const slug = p.handle ?? p.public_id ?? params.handle;
  const isOwner = !!viewer && viewer.id === p.id;
  const initialFollowing = viewer && !isOwner ? await isFollowing(viewer.id, p.id) : false;
  const viewerBlocked = viewer && !isOwner ? await isBlockedByMe(viewer.id, p.id) : false;
  const name = p.display_name || (p.handle ? `@${p.handle}` : 'Analyst');
  const tab = pickTab(searchParams?.tab);
  const joined = p.created_at ? new Date(p.created_at).getUTCFullYear() : null;
  const initials = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'EY';

  // Founding Partner status (mig 076) + First Ten data. The emblem is
  // public; the First Ten panel is owner-only and only while the Note
  // is not yet shown.
  const admin = createServerSupabase();
  const partner = await getFoundingPartner(admin, p.id);
  const noteShown = (data.reputationNote?.note ?? null) !== null;
  const showFirstTen = isOwner && !noteShown;
  const [fastMarkets, firmsFacilities]: [FastMarket[], FirmsTemplate[]] = showFirstTen
    ? await Promise.all([
        loadFastClosingMarkets(admin),
        loadFirmsFacilityTemplates(admin),
      ])
    : [[], []];

  return (
    <article style={{ maxWidth: 980, margin: '0 auto', padding: '36px 24px 72px' }}>
      {/* Cover strip — a subtle teal-tinted default when none is set (§3.1). */}
      <div
        style={{
          height: 140,
          borderRadius: 10,
          background: p.cover_url
            ? `center/cover no-repeat url("${p.cover_url}")`
            : 'linear-gradient(118deg, var(--teal-glow), var(--bg-panel) 72%)',
          border: '1px solid var(--rule)',
        }}
      />
      <header
        style={{
          display: 'flex',
          gap: 20,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          marginTop: 16,
          paddingLeft: 4,
        }}
      >
        {/* Framed avatar, lifted to overlap the cover's bottom edge. */}
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: '50%',
            flexShrink: 0,
            marginTop: -56,
            border: '3px solid var(--bg-void)',
            boxShadow: '0 0 0 1px var(--rule)',
            background: p.avatar_url
              ? `center/cover no-repeat url("${p.avatar_url}")`
              : 'var(--bg-raised)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--ink-faint)',
            fontFamily: 'var(--f-display)',
            fontSize: 28,
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
            {partner && <FoundingPartnerChip />}
            {p.is_founding_analyst && <Pill tone="teal">Founding Analyst</Pill>}
            {data.spaces.length > 0 && <Pill tone="teal">Creator</Pill>}
            {joined && (
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>
                joined {joined}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          {isOwner ? (
            <Link href="/settings/profile" style={settingsBtn} prefetch={false}>
              Profile settings
            </Link>
          ) : (
            <FollowButton profileId={p.id} isAuthed={!!viewer} initialFollowing={initialFollowing} />
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <ShareButton />
            {!isOwner && <MessageButton profileId={p.id} isAuthed={!!viewer} />}
            {!isOwner && viewer && <ProfileModeration profileId={p.id} blocked={viewerBlocked} />}
            <SoonChip>Subscribe</SoonChip>
          </div>
        </div>
      </header>

      {/* Four-stat strip (§3.1). */}
      <StatStrip
        stats={[
          { label: 'Followers', value: fmtCount(data.followers) },
          { label: 'Following', value: fmtCount(data.following) },
          { label: 'Spaces', value: String(data.spaces.length) },
          { label: 'Resolved', value: String(data.resolvedCount) },
        ]}
      />

      {/* Dominant Reputation Note band — the first credibility signal a
          visitor reads, directly under the identity hero (UX Uplift §3.1).
          Two-sided since the Founding Partner programme (cosmetic spec
          2026-07-05): Note LEFT (earned, epistemic), Founding Partner
          emblem RIGHT (vetted, curatorial), same geometry. Non-partners
          see the single-sided band — never an empty placeholder. */}
      <div style={{ display: 'flex', gap: 14, marginTop: 18, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div style={{ flex: '2 1 380px', minWidth: 300 }}>
          <ReputationNote
            size="hero"
            note={data.reputationNote?.note ?? null}
            nResolved={data.reputationNote?.nResolved ?? data.resolvedCount}
            percentile={data.reputationNote?.percentile ?? null}
            coverage={data.reputationNote?.coverage ?? null}
          />
        </div>
        {partner && (
          <div style={{ flex: '1 1 300px', minWidth: 280 }}>
            <FoundingPartnerEmblem grantedYear={new Date(partner.granted_at).getUTCFullYear()} />
          </div>
        )}
      </div>

      {/* The First Ten — own-profile onboarding sprint to the shown
          Note (Founding Partner build-prompt §7). Fast-closing REAL
          Polymarket markets; a call from here is an ordinary sealed
          prediction. Partners also see their deadline countdown. */}
      {isOwner && (data.reputationNote?.note ?? null) === null && (
        <div style={{ marginTop: 14 }}>
          <FirstTenPanel
            resolvedCount={data.reputationNote?.nResolved ?? data.resolvedCount}
            markets={fastMarkets}
            facilities={firmsFacilities}
            deadline={partner && partner.status !== 'graduated' ? partner.note_deadline : null}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 28, marginTop: 28, flexWrap: 'wrap' }}>
        <aside style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ReputationPassport resolvedCount={data.resolvedCount} reputation={data.reputation} />
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
            {tab === 'predictions' && (
              <>
                {isOwner && <MakeACall />}
                <PredictionsTab predictions={data.predictions} />
              </>
            )}
            {tab === 'wall' && <Wall initialPosts={data.wall} isOwner={isOwner} />}
            {tab === 'spaces' && <SpacesTab spaces={data.spaces} isOwner={isOwner} />}
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

const settingsBtn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#FFFFFF',
  background: 'var(--red)',
  border: '1px solid var(--red)',
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

const emptyBox: CSSProperties = {
  padding: '28px 20px',
  textAlign: 'center',
  border: '1px dashed var(--rule)',
  borderRadius: 6,
  color: 'var(--ink-faint)',
  fontSize: 12.5,
  lineHeight: 1.6,
};

function PredictionsTab({ predictions }: { predictions: ProfilePrediction[] }) {
  if (predictions.length === 0) {
    return (
      <div style={emptyBox}>
        No published predictions yet. When this analyst makes a call it’s sealed, auto-resolved
        against live data, and scored here.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {predictions.map((pr, i) => (
        <PredictionRowView key={pr.public_id ?? i} p={pr} />
      ))}
    </div>
  );
}

// A prediction row across its three states: a resolved call shows the
// outcome + per-call brier-skill; a sealed (commit-reveal) call shows only
// the hash + resolve date (plaintext withheld); an open call shows its
// forecast and resolve date. Provable, not performative.
function PredictionRowView({ p }: { p: ProfilePrediction }) {
  const win = p.status === 'resolved' && isWin(p);
  const chip =
    p.status === 'resolved'
      ? { label: win ? 'WIN' : 'MISS', color: win ? 'var(--green)' : 'var(--red)' }
      : p.status === 'sealed'
        ? { label: 'SEALED', color: 'var(--amber)' }
        : { label: 'OPEN', color: 'var(--ink-dim)' };

  const meta: string[] = [];
  if (p.horizonHours != null) meta.push(`${fmtHorizon(p.horizonHours)} horizon`);
  if (p.status === 'sealed') {
    if (p.commitHash) meta.push(`commit ${p.commitHash.slice(0, 10)}…`);
    if (p.resolves_at) meta.push(`resolves ${fmtDate(p.resolves_at)}`);
  } else {
    if (p.predicted_mean != null) meta.push(`p ${p.predicted_mean.toFixed(2)}`);
    if (p.baseline != null) meta.push(`base ${p.baseline.toFixed(2)}`);
    if (p.status === 'resolved') {
      if (p.observed_value != null) meta.push(`obs ${p.observed_value.toFixed(2)}`);
      if (p.brierSkill != null) meta.push(`skill ${fmtSkill(p.brierSkill)}`);
    } else if (p.resolves_at) {
      meta.push(`resolves ${fmtDate(p.resolves_at)}`);
    }
  }

  const sealedNoText = p.status === 'sealed' && !p.statement;
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--rule-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span
          style={{
            flex: 1,
            fontSize: 13,
            lineHeight: 1.45,
            color: sealedNoText ? 'var(--ink-dim)' : 'var(--ink)',
            fontStyle: sealedNoText ? 'italic' : 'normal',
          }}
        >
          {p.status === 'sealed' && <span style={{ marginRight: 6 }}>🔒</span>}
          {sealedNoText ? 'Sealed call — plaintext revealed on resolution' : p.statement ?? '—'}
        </span>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            color: chip.color,
            border: `1px solid ${chip.color}`,
            borderRadius: 999,
            padding: '2px 8px',
            flexShrink: 0,
          }}
        >
          {chip.label}
        </span>
      </div>
      {meta.length > 0 && (
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10.5,
            color: 'var(--ink-faint)',
            marginTop: 5,
            letterSpacing: '0.02em',
          }}
        >
          {meta.join('  ·  ')}
        </div>
      )}
    </div>
  );
}

// A resolved call "wins" if it beat the baseline (skill > 0); fall back to a
// closer-than-the-complement check when no baseline skill is available.
function isWin(p: ProfilePrediction): boolean {
  if (p.brierSkill != null) return p.brierSkill > 0;
  if (p.predicted_mean == null || p.observed_value == null) return false;
  return Math.abs(p.predicted_mean - p.observed_value) < Math.abs(1 - p.predicted_mean - p.observed_value);
}

function SpacesTab({ spaces, isOwner }: { spaces: ProfileSpace[]; isOwner: boolean }) {
  if (spaces.length === 0) {
    return (
      <div style={emptyBox}>
        {isOwner
          ? 'You don’t run any public spaces yet — create one from COMM ▸ Spaces.'
          : 'This analyst doesn’t run any public spaces yet.'}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {spaces.map((s) => (
        <Link
          key={s.spaceId}
          href={`/spaces/${s.spaceId}`}
          prefetch={false}
          style={{
            display: 'block',
            textDecoration: 'none',
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule)',
            borderRadius: 8,
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ flex: 1, fontFamily: 'var(--f-display)', fontSize: 15, color: 'var(--ink)' }}>
              {s.title ?? 'Untitled space'}
            </span>
            {s.status === 'paused' && (
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 9.5,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--amber)',
                  border: '1px solid var(--amber)',
                  borderRadius: 999,
                  padding: '2px 7px',
                }}
              >
                Paused
              </span>
            )}
          </div>
          {s.blurb && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: '6px 0 0', lineHeight: 1.5 }}>{s.blurb}</p>
          )}
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--teal)', marginTop: 8 }}>
            {s.priceUsdc != null && s.priceUsdc > 0 ? `$${fmtUsdc(s.priceUsdc)} USDC / ${s.cadence ?? 'month'}` : 'Free'}
          </div>
        </Link>
      ))}
    </div>
  );
}

function StatStrip({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <div
      style={{
        display: 'flex',
        marginTop: 18,
        border: '1px solid var(--rule)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--bg-panel)',
      }}
    >
      {stats.map((s, i) => (
        <div key={s.label} style={{ flex: 1, padding: '12px 16px', borderLeft: i ? '1px solid var(--rule)' : undefined }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 19, color: 'var(--ink)' }}>{s.value}</div>
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-dim)',
              marginTop: 3,
            }}
          >
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function fmtCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function fmtUsdc(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function fmtHorizon(hours: number): string {
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function fmtSkill(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
