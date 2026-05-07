import type { Metadata } from 'next';
import Link from 'next/link';
import { SubmissionForm } from './SubmissionForm';

// /grow — public-facing surface for the referral program. Spec §3.
//
// Single page with five sections in this exact order (spec §3.1):
//   1. Philosophy statement (locked copy from §3.2)
//   2. Three-bullet description of how attribution works
//   3. Founder advocate program intro — no commission rates publicly
//   4. The inbound submission form
//   5. FAQ block (locked copy from §3.4)
//
// Linked from the marketing footer and from /settings (logged-in
// users). Indexed by search engines — this is the program's only
// public surface.

export const metadata: Metadata = {
  title: 'How eYKON grows — referral mechanic and founder advocate program',
  description:
    'eYKON grows through the work itself. Every analytical view is shareable, and every share is attributed automatically. Beyond that, we partner with practitioners through a hand-curated founder advocate program.',
};

export default function GrowPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

  return (
    <article
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '80px 32px 120px',
        color: 'var(--ink)',
      }}
    >
      <header style={{ marginBottom: 36 }}>
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            marginBottom: 12,
          }}
        >
          How eYKON grows
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 'clamp(28px, 4.4vw, 40px)',
            lineHeight: 1.15,
            letterSpacing: '-0.015em',
            margin: 0,
          }}
        >
          Through the work, not the funnel.
        </h1>
      </header>

      <Section>
        <p style={proseLead}>
          eYKON grows through the work itself. Every analytical view you
          create — a replayed case study, a calibration snapshot, a
          notification fire, an analyst conversation — is shareable, and
          every share is attributed automatically. You don&apos;t need to
          do anything special.
        </p>
        <p style={proseLead}>
          Beyond that, we partner directly with practitioners whose
          endorsement carries weight in their professional networks. We
          don&apos;t run a generic affiliate program because we don&apos;t
          think that&apos;s the right shape for an intelligence platform.
          If you&apos;d like to be considered for our advocate program,
          tell us about your network below.
        </p>
      </Section>

      <SectionHeading>How attribution works for ordinary users</SectionHeading>
      <Section>
        <ul style={bulletList}>
          <li style={bullet}>
            When you share a link from inside eYKON — from a Share button or a
            Copy Link action — the URL carries a small parameter that
            identifies you as the source. No checkboxes, no consent dialog.
          </li>
          <li style={bullet}>
            If the person you share with eventually signs up for a paid
            account, we know it came from you. Attribution sticks for 90 days
            from the first click.
          </li>
          <li style={bullet}>
            Ordinary attributed shares don&apos;t generate cash payments.
            They&apos;re a recognition signal we use to identify users who
            organically drive meaningful inbound — and to invite the
            strongest of them into the program below.
          </li>
        </ul>
      </Section>

      <SectionHeading>The founder advocate program</SectionHeading>
      <Section>
        <p style={prose}>
          A hand-curated partnership program for practitioners — analysts,
          traders, journalists, researchers, newsletter authors, podcast
          hosts — whose endorsement carries weight in their professional
          networks. Advocates receive cash compensation for paid referrals
          on terms agreed bilaterally. We onboard advocates by invitation
          or via the form below.
        </p>
      </Section>

      <SectionHeading>Tell us about your network</SectionHeading>
      <SubmissionForm turnstileSiteKey={turnstileSiteKey} />

      <SectionHeading>FAQ</SectionHeading>
      <Faq
        q="How does the attribution mechanic work?"
        a="When you share an eYKON link with someone — a case study replay, an analyst conversation, a calibration snapshot — the link carries a small parameter that identifies you as the source. If the person you share with eventually signs up for a paid eYKON account, we know it came from you. This works for any link generated through our share buttons or copy-link actions, anywhere in the platform."
      />
      <Faq
        q="Do I get paid for ordinary sharing?"
        a="No. Ordinary attributed shares are recognised internally but do not generate commission payments. We use this signal to identify users who are organically driving meaningful inbound, and we invite the strongest organic sharers into our founder advocate program."
      />
      <Faq
        q="What is the founder advocate program?"
        a="A hand-curated partnership program for practitioners — analysts, traders, journalists, researchers, newsletter authors, podcast hosts — whose endorsement carries weight in their professional networks. Advocates receive cash compensation for paid referrals on terms agreed bilaterally. We onboard advocates by invitation or via the form on this page."
      />
      <Faq
        q="Why don't you run a regular affiliate program?"
        a="Two reasons. First, the audiences eYKON serves — OSINT analysts, day-traders, commodities desks — are sophisticated enough that an open affiliate program would attract low-quality referrals and dilute our positioning as a serious intelligence platform. Second, our highest-leverage referrers are practitioners with real audiences, not anonymous affiliates; we'd rather invest in deep partnerships with a small number of advocates than spread thin commissions across many."
      />
      <Faq
        q="What happens after I submit the form?"
        a="We review every submission, usually within a week. If we think there is a strong fit, we will reach out via your provided email with the partnership document and an invitation. If the fit is not yet right — for example, we feel your audience is in a category we are not currently optimised for — we will reply honestly. We do not auto-reject submissions; every response comes from the founder."
      />

      <footer style={{ marginTop: 64, color: 'var(--ink-faint)', fontSize: 12 }}>
        <Link href="/" style={{ color: 'var(--ink-faint)', textDecoration: 'underline' }}>
          ← Back to eYKON.ai
        </Link>
      </footer>
    </article>
  );
}

// ─── Layout primitives ─────────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
  return <section style={{ marginBottom: 36 }}>{children}</section>;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-dim)',
        marginTop: 40,
        marginBottom: 16,
        paddingTop: 16,
        borderTop: '1px solid var(--rule-soft)',
      }}
    >
      {children}
    </h2>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 15,
          color: 'var(--ink)',
          marginBottom: 6,
        }}
      >
        {q}
      </div>
      <p
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13.5,
          lineHeight: 1.6,
          color: 'var(--ink-dim)',
          margin: 0,
        }}
      >
        {a}
      </p>
    </div>
  );
}

const proseLead: React.CSSProperties = {
  fontFamily: 'var(--f-body)',
  fontSize: 16,
  lineHeight: 1.6,
  color: 'var(--ink)',
  margin: '0 0 18px',
};

const prose: React.CSSProperties = {
  fontFamily: 'var(--f-body)',
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--ink-dim)',
  margin: 0,
};

const bulletList: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
};

const bullet: React.CSSProperties = {
  fontFamily: 'var(--f-body)',
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--ink-dim)',
  marginBottom: 14,
  paddingLeft: 18,
  position: 'relative',
};
