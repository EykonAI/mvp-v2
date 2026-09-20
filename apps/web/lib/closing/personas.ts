/**
 * The five personas of the three-step funnel (brief v1.4 §4.0).
 *
 * Each carries its own pitch, because a day-trader and a journalist want
 * opposite things from the same platform: one wants to be early, the
 * other wants to be able to cite it. Slugs match migration 108's CHECK
 * and the API's PERSONAS set — a mismatch is a 400 on every submission.
 *
 * COPY RULE (brief §4.9): the ZL prototype's scripts said "sealed with a
 * hash" and "six chokepoints, tested nightly". Both are corrected here
 * and must stay corrected. Sealing is the CREATOR-track commit-reveal
 * mechanic; house forecasts are HASHED and publicly recomputable
 * (#367). And four chokepoints carry data, not six — verified against
 * production 2026-08-16.
 */
export type PersonaId = 'trader' | 'analyst' | 'journalist' | 'risk' | 'citizen';

/**
 * Step-3's week-one question, asked as free text instead of chips.
 *
 * The OSINT one-pager ends on an offer — "Send us a claim: a facility and
 * a date" — and /start had nowhere to put one. Rather than add a seventh
 * question, the persona that receives that offer answers the SAME step-3
 * question in prose (Reality Check build prompt rev H §10, PR-9).
 *
 * The typed text is what lands in closing_leads.need; that column is
 * plain nullable text with no CHECK (migration 108, re-read in production
 * 2026-09-20), so prose stores where a slug used to. One shape, one
 * column, no migration.
 *
 * This is also the API's source of truth: POST /api/closing/lead reads
 * claimFieldFor(persona) to decide whether `need` is a slug or free text,
 * and how long it may be. A second copy of that rule would drift.
 */
export interface ClaimField {
  /** Accessible name of the input — also its visible <label>. */
  label: string;
  placeholder: string;
  hint: string;
  /** Enforced on BOTH sides: maxLength on the input, slice() in the route. */
  maxLength: number;
}

export interface Persona {
  id: PersonaId;
  /** Step-1 card */
  label: string;
  blurb: string;
  /** Step-2 pitch */
  tag: string;
  head: string;
  headAccent: string;
  issue: string;
  usps: Array<{ title: string; body: string }>;
  /** Step-3 framing */
  marketsLabel: string;
  cta: string;
  fine: string;
  /** Present only where step 3 asks for prose. Absent = the chip list. */
  claim?: ClaimField;
}

export const PERSONAS: Persona[] = [
  {
    id: 'trader',
    label: 'Day-trader',
    blurb: 'Macro, commodities, crypto',
    tag: '· built for day-traders',
    head: 'You hear it when the internet does.',
    headAccent: 'We see it before.',
    issue:
      '“By the time it’s news, the move already happened. I’m trading other people’s latency.”',
    usps: [
      {
        title: 'Owned sensors',
        body: 'Thermal, night-lights, vessels — instruments we operate. A licence can be revoked; our feed can’t.',
      },
      {
        title: 'Nightly baseline tests',
        body: 'Six theatres × five signals, KS-tested every night against their own 60-day baseline. A p-value, not a vibe.',
      },
      {
        title: 'Audited calls',
        body: 'Every forecast hashed at issue and scored at resolution — recompute the hash yourself. Wrong calls stay on the record.',
      },
    ],
    marketsLabel: 'What do you trade?',
    cta: 'Claim my founding rate',
    fine: '14-day full refund · crypto settles in minutes · or $9 Week Pass during a live event',
  },
  {
    id: 'analyst',
    label: 'OSINT analyst',
    blurb: 'Investigation & research',
    tag: '· built for OSINT analysts',
    head: 'Ten tabs, no correlation.',
    headAccent: 'One globe, full provenance.',
    issue:
      '“FR24 here, MarineTraffic there, GDELT somewhere else — and I’m the correlation engine, by hand, at 2am.”',
    usps: [
      {
        title: 'The assembled view',
        body: 'Every feed on one globe with inline provenance — the stack you built by hand, in one surface.',
      },
      {
        title: 'Independence scoring',
        body: 'Evidence scored by source class, not count. Two outlets ≠ two sources — we say so.',
      },
      {
        title: 'The honesty slice',
        body: 'What’s live, what’s thin, what we lack — published below, generated when this page loaded. No vendor shows you the red lights.',
      },
    ],
    marketsLabel: 'What do you cover?',
    cta: 'Start free as Observer',
    fine: 'No card · no time limit · the founding rate is there whenever you’re ready',
    // The OSINT one-pager's closing offer, made answerable on the page
    // itself. Wording fixed by rev H §10 — if the one-pager is re-issued
    // with different words, this string moves with it.
    claim: {
      label: 'A claim you want checked — a facility and a date',
      placeholder: 'Kirishi refinery — 14 September 2026',
      hint: 'One line is enough. We run it against the thermal, night-lights and vessel feeds — and when a site sits outside what we watch, we say so rather than guess.',
      maxLength: 280,
    },
  },
  {
    id: 'journalist',
    label: 'Journalist',
    blurb: 'Newsroom or independent',
    tag: '· built for journalists',
    head: 'Claims you can',
    headAccent: 'cite, check, and audit.',
    issue:
      '“Every intelligence source wants my trust. None of them will show me their track record.”',
    usps: [
      {
        title: 'The Calibration Ledger',
        body: 'Brier and log-loss across 7/30/90 days, published — including the stretches where we score worse than climatology.',
      },
      {
        title: 'Hashed forecasts',
        body: 'SHA-256 over the claim at issue, scored at resolution — a paper trail you can independently recompute in your own browser.',
      },
      {
        title: 'Sensor data, not sources',
        body: 'When we saw Kuwait go dark from orbit, that was an instrument reading you can verify — not a source you have to trust.',
      },
    ],
    marketsLabel: 'What do you cover?',
    cta: 'Get verified for press access',
    fine: 'Press card → verify@eykon.ai · we’ll confirm the rate when we reply',
  },
  {
    id: 'risk',
    label: 'Risk / commodities desk',
    blurb: 'Corporate or trading desk',
    tag: '· built for risk & commodities desks',
    head: 'Your chokepoint exposure,',
    headAccent: 'tested nightly.',
    issue:
      '“Sanctions lists move weekly, chokepoints wobble monthly — and my early warning is a news alert like everyone else’s.”',
    usps: [
      {
        title: 'Posture, not headlines',
        body: 'Six pinned theatres, posture refreshed every 30 minutes, baseline-tested nightly at p < 0.01.',
      },
      {
        title: 'Sanctions cascade',
        body: 'Designation → counterparty → exposure, mapped through a 2,113-entity OFAC actor graph.',
      },
      {
        title: 'Team tier',
        body: 'Shared watchlists, annotation, REST API, 5,000 analyst queries per seat — $831.60/seat/yr at the founding rate.',
      },
    ],
    marketsLabel: 'What does your desk cover?',
    cta: 'Start a 3-seat team',
    fine: '3-seat minimum · locked for life · dedicated support on Enterprise',
  },
  {
    id: 'citizen',
    label: 'Curious citizen',
    blurb: 'I just want to see the world clearly',
    tag: '· built for the curious',
    head: 'The world is moving.',
    headAccent: 'Watch it live — free.',
    issue: '“I read about the world second-hand. I want to see it first-hand.”',
    usps: [
      {
        title: 'The map is free',
        body: 'All live layers, no card, no countdown. You pay for intelligence, never the map.',
      },
      {
        title: 'A daily brief',
        body: 'What mattered in the last 24 hours, composed from the feeds — free on your home screen.',
      },
      {
        title: 'Grow into it',
        body: '5 free analyst queries a month. If it becomes your edge, the founding rate is waiting.',
      },
    ],
    marketsLabel: 'What do you follow?',
    cta: 'Start observing — free',
    fine: 'Free forever · no card required · the founding rate is there when you’re ready',
  },
];

export const PERSONA_BY_ID = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p]),
) as Record<PersonaId, Persona>;

export function isPersonaId(v: string | null | undefined): v is PersonaId {
  return !!v && v in PERSONA_BY_ID;
}

/**
 * The step-3 free-text prompt for a persona slug, or null when that
 * persona answers with chips.
 *
 * Read by BOTH the form and POST /api/closing/lead. The route must not
 * trust the client about which shape `need` arrives in — it re-derives
 * it from the persona slug it is about to store, so a forged free-text
 * `need` on a chip persona is still rejected to null exactly as before.
 */
export function claimFieldFor(persona: string | null | undefined): ClaimField | null {
  if (!isPersonaId(persona)) return null;
  return PERSONA_BY_ID[persona].claim ?? null;
}
