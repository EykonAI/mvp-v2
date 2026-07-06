// COMM landing section — the community pillar surfaced on the marketing
// page (landing update brief 2026-07-06 §5). Three blocks: the reputation
// spine, the creator economy, and the Founding Partner band. Copy rules:
// the Reputation Note is NEVER framed as purchasable, and the Founding
// Partner CTA is a quiet mailto — the programme is vetted, never
// self-serve. Rendered inside .eykon-landing, so landing.css applies.

const SPINE_TILES = [
  {
    label: 'C-01 · SEALED CALLS',
    title: 'Sealed calls.',
    body: 'Predictions are committed with a SHA-256 hash before the outcome, revealed after, and scored against live market resolution. No edits, no deletions — wrong calls stay on the record.',
  },
  {
    label: 'C-02 · THE NOTE',
    title: 'The Reputation Note.',
    body: 'Ten resolved predictions earn a public Note — a Brier-skill score on your profile. It is never for sale: no tier, no payment, no partnership changes it.',
  },
  {
    label: 'C-03 · THE NETWORK',
    title: 'The social layer.',
    body: 'Public profiles, follow-radar, DMs, group rooms — and rooms that auto-spawn from live convergence events, with an AI analyst you can summon to ground the argument in data.',
  },
];

const CREATOR_TILES = [
  {
    label: 'C-04 · SPACES',
    title: 'Subscription revenue, non-custodial.',
    body: 'Paid Spaces settle in USDC on Base through your own Unlock lock — your lock, your wallet, eYKON never holds your funds. Platform fee: 15%, enforced on-chain.',
  },
  {
    label: 'C-05 · BOUNTY',
    title: 'The 25% conversion bounty.',
    body: 'When a member of your Space upgrades to an eYKON plan, you earn 25% of their first-year subscription, paid monthly in USDC.',
  },
  {
    label: 'C-06 · CREATOR PRO',
    title: 'Creator Pro.',
    body: '$20/month — free for life for the first 50 creators. Subscriber, churn and earnings dashboard; an embeddable reputation card for your own site and socials; Space branding; priority placement in Discover.',
  },
];

export function CommShowcase() {
  return (
    <section className="section" id="community">
      <div className="section-head">
        <div className="section-kicker">·· COMM · The community ··</div>
        <h2 className="section-title">
          Reputation you can <span className="accent">audit</span>, not follower counts.
        </h2>
        <p className="section-sub">
          COMM is where eYKON stops being a tool and becomes a network — forecasting skill
          made measurable, discussable, and monetisable.
        </p>
      </div>

      <div className="comm-tiles">
        {SPINE_TILES.map(t => (
          <div className="pillar" key={t.label}>
            <div className="pillar-label">{t.label}</div>
            <div className="pillar-title">{t.title}</div>
            <p className="pillar-body">{t.body}</p>
          </div>
        ))}
      </div>

      <div className="comm-subhead">
        Calibrated analysts run paid Spaces — <span className="accent">and keep the keys</span>.
      </div>

      <div className="comm-tiles">
        {CREATOR_TILES.map(t => (
          <div className="pillar" key={t.label}>
            <div className="pillar-label">{t.label}</div>
            <div className="pillar-title">{t.title}</div>
            <p className="pillar-body">{t.body}</p>
          </div>
        ))}
      </div>

      <div className="fp-band">
        <div className="fp-band-title">
          The eYKON Founding Partner programme — <span className="accent">20 seats, ever</span>.
        </div>
        <p className="fp-band-body">
          eYKON&apos;s rule is simple: you don&apos;t charge a community until your track
          record is provable — ten resolved, sealed predictions, scored in public, wrong
          calls left standing. The Founding Partner programme is the bridge for analysts who
          arrive with their credibility already earned elsewhere. Twenty creators — vetted
          for tone, reach and credibility, never self-serve — receive immediate paid-Space
          rights, Creator Pro for life, and the Founding Partner emblem on their profile, in
          exchange for one commitment: earn your Reputation Note within six months, on the
          same commit-reveal rules as everyone else. Until then, the profile says exactly
          what is true — vetted partner, still calibrating — because the emblem is chosen,
          but the ring next to it has to be earned.
        </p>
        <p className="fp-band-remaining">
          The first slot is taken. <strong>Nineteen remain.</strong>
        </p>
        <p className="fp-band-cta">
          Vetted partners are invited — introduce yourself:{' '}
          <a href="mailto:partners@eykon.ai?subject=Founding%20Partner">partners@eykon.ai</a>
        </p>
      </div>

      <p className="integrity-line">
        The score is never for sale. No tier, no payment, no partnership changes the ring.
      </p>
    </section>
  );
}
