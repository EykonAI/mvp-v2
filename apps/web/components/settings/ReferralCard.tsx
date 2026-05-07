import Link from 'next/link';
import type { AdvocateState } from '@/lib/auth/session';

/**
 * Settings card surfacing how sharing works on eYKON for ordinary
 * users, and the advocate-status surface for users who have been
 * invited into the founder advocate program.
 *
 * Spec §0.1 + §1.5: ordinary users see no commission UI, no
 * affiliate dashboard, no leaderboard. Attribution runs silently
 * via the Share buttons on each artifact (PRs 4–5). The default
 * card here just explains the model and points to /grow for the
 * dedicated program page.
 *
 * For users in any advocate state (`invited` / `active` / `paused`
 * / `terminated`), a state-aware card appears with the relevant
 * guidance and CTAs — Rewardful payout-setup link for active
 * advocates once the engine ships (PR 7), partnership-doc reminder
 * for invited candidates, etc.
 */
export function ReferralCard({
  advocateState,
  advocateInvitedAt,
  advocateOnboardedAt,
  rewardfulAffiliateId,
}: {
  advocateState: AdvocateState;
  advocateInvitedAt: string | null;
  advocateOnboardedAt: string | null;
  rewardfulAffiliateId: string | null;
}) {
  if (advocateState === 'none') {
    return <DefaultCard />;
  }
  return (
    <AdvocateCard
      state={advocateState}
      invitedAt={advocateInvitedAt}
      onboardedAt={advocateOnboardedAt}
      rewardfulAffiliateId={rewardfulAffiliateId}
    />
  );
}

// ─── Default card (advocate_state = 'none') ───────────────────

function DefaultCard() {
  return (
    <Card>
      <Kicker>·· Sharing on eYKON ··</Kicker>
      <Title>How sharing works</Title>
      <Body>
        When you share an analyst conversation or a notification fire from
        inside eYKON, the link automatically attributes the visit to you.
        Nothing to set up. Share buttons live on each conversation and fire,
        and a public, redacted view opens for whoever you send it to.
      </Body>
      <Body>
        Ordinary attributed shares don&apos;t generate cash payments — they
        feed an internal recognition signal we use to invite the strongest
        organic sharers into our founder advocate program.
      </Body>
      <div style={{ marginTop: 16 }}>
        <Link
          href="/grow"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            textDecoration: 'none',
            borderBottom: '1px dashed var(--teal)',
            paddingBottom: 1,
          }}
        >
          How eYKON grows →
        </Link>
      </div>
    </Card>
  );
}

// ─── Advocate-state card ──────────────────────────────────────

function AdvocateCard({
  state,
  invitedAt,
  onboardedAt,
  rewardfulAffiliateId,
}: {
  state: Exclude<AdvocateState, 'none'>;
  invitedAt: string | null;
  onboardedAt: string | null;
  rewardfulAffiliateId: string | null;
}) {
  const payoutSetupUrl = process.env.REWARDFUL_PAYOUT_SETUP_URL ?? null;

  return (
    <Card>
      <Kicker>·· Founder advocate program ··</Kicker>
      <Title>{titleFor(state)}</Title>
      <StatusStrip state={state} invitedAt={invitedAt} onboardedAt={onboardedAt} />
      {state === 'invited' && <InvitedBody />}
      {state === 'active' && (
        <ActiveBody
          rewardfulAffiliateId={rewardfulAffiliateId}
          payoutSetupUrl={payoutSetupUrl}
        />
      )}
      {state === 'paused' && <PausedBody />}
      {state === 'terminated' && <TerminatedBody />}
      <div style={{ marginTop: 16, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Link
          href="/grow"
          style={subtleLinkStyle}
        >
          Program page →
        </Link>
        <a href="mailto:support@eykon.ai" style={subtleLinkStyle}>
          Advocate questions →
        </a>
      </div>
    </Card>
  );
}

function titleFor(state: Exclude<AdvocateState, 'none'>): string {
  switch (state) {
    case 'invited':
      return 'You’re invited';
    case 'active':
      return 'You’re an active founder advocate';
    case 'paused':
      return 'Your participation is paused';
    case 'terminated':
      return 'Your participation has concluded';
  }
}

function StatusStrip({
  state,
  invitedAt,
  onboardedAt,
}: {
  state: Exclude<AdvocateState, 'none'>;
  invitedAt: string | null;
  onboardedAt: string | null;
}) {
  const dot =
    state === 'active'
      ? 'var(--teal)'
      : state === 'invited'
        ? 'var(--amber, #f5c66b)'
        : 'var(--ink-dim)';
  const dateText =
    state === 'invited' && invitedAt
      ? `invited ${invitedAt.slice(0, 10)}`
      : state === 'active' && onboardedAt
        ? `onboarded ${onboardedAt.slice(0, 10)}`
        : state === 'paused' && onboardedAt
          ? `originally onboarded ${onboardedAt.slice(0, 10)}`
          : null;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px',
        background: 'var(--bg-raised)',
        border: '1px solid var(--rule)',
        borderRadius: 12,
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--ink-dim)',
        marginBottom: 16,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
      {state}
      {dateText && (
        <span style={{ color: 'var(--ink-faint)' }}>· {dateText}</span>
      )}
    </div>
  );
}

function InvitedBody() {
  return (
    <>
      <Body>
        We sent the partnership document to your email. Reply with the
        signed copy and we&apos;ll move you to active — at which point the
        Rewardful payout setup link arrives in your inbox.
      </Body>
      <Body>
        The invitation stays open for 14 days. If the timing isn&apos;t
        right, replying to say so is welcome — we&apos;ll revisit later
        without removing your audience-side access.
      </Body>
    </>
  );
}

function ActiveBody({
  rewardfulAffiliateId,
  payoutSetupUrl,
}: {
  rewardfulAffiliateId: string | null;
  payoutSetupUrl: string | null;
}) {
  if (rewardfulAffiliateId) {
    return (
      <Body>
        Commission accrues per the terms in your partnership document. Payouts
        run through Rewardful on the standard cadence. Reply to{' '}
        <a href="mailto:support@eykon.ai" style={inlineLinkStyle}>
          support@eykon.ai
        </a>{' '}
        with any payout questions.
      </Body>
    );
  }
  // No Rewardful affiliate id yet — engine PRs 7-9 either haven't shipped
  // or the affiliate creation hasn't fired. Show the payout-setup CTA
  // when the env var is configured; otherwise a holding message.
  if (payoutSetupUrl) {
    return (
      <>
        <Body>
          Welcome aboard. One administrative step before the first payout —
          complete your Rewardful payout setup (W-9 / W-8BEN + Stripe Connect)
          via the link below. Without it, accruals stay pending.
        </Body>
        <div style={{ marginTop: 14 }}>
          <a
            href={payoutSetupUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={ctaButtonStyle}
          >
            Complete payout setup →
          </a>
        </div>
      </>
    );
  }
  return (
    <Body>
      Welcome aboard. The payout setup activates once the program engine
      goes live — we&apos;ll email you the Rewardful link when it&apos;s
      ready, no action needed in the meantime.
    </Body>
  );
}

function PausedBody() {
  return (
    <Body>
      No new commission relationships will form while paused. Existing
      commissioned referrals continue to accrue and pay out on their
      original 24-month windows. Reply to{' '}
      <a href="mailto:support@eykon.ai" style={inlineLinkStyle}>
        support@eykon.ai
      </a>{' '}
      to resume or wind down.
    </Body>
  );
}

function TerminatedBody() {
  return (
    <Body>
      New shares from this account no longer create commission
      relationships. Existing commissioned referrals continue per their
      original terms; previously-paid commission is unaffected.
    </Body>
  );
}

// ─── Layout primitives ────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '24px 28px',
        marginBottom: 24,
      }}
    >
      {children}
    </section>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--teal)',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: 'var(--f-display)',
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: '-0.3px',
        color: 'var(--ink)',
        marginBottom: 12,
      }}
    >
      {children}
    </h2>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        color: 'var(--ink-dim)',
        fontSize: 13,
        lineHeight: 1.6,
        marginBottom: 12,
      }}
    >
      {children}
    </p>
  );
}

const subtleLinkStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-dim)',
  textDecoration: 'none',
  borderBottom: '1px dashed var(--rule-strong)',
  paddingBottom: 1,
};

const inlineLinkStyle: React.CSSProperties = {
  color: 'var(--teal)',
  textDecoration: 'none',
  borderBottom: '1px dashed var(--teal)',
};

const ctaButtonStyle: React.CSSProperties = {
  display: 'inline-block',
  fontFamily: 'var(--f-mono)',
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  border: '1px solid var(--teal)',
  borderRadius: 4,
  padding: '11px 18px',
  textDecoration: 'none',
  fontWeight: 600,
};
