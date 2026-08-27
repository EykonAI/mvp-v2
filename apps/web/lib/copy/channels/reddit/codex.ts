// ─── THE REDDIT CRAFT CODEX ──────────────────────────────────────
//
// Faithful conversion of docs/copywriters/reddit-codex.draft.md
// (PR-0, 2026-08-27) into the durable, versioned artifact the RUNTIME
// reads. Authored and owned by the reddit-copywriter subagent
// (.claude/agents/reddit-copywriter.md); nothing here is fetched or
// learned at run time.
//
// WHY THIS IS A .ts AND NOT THE .md: a runtime fs.readFile of a
// markdown file inside a Next server bundle is the exact "code
// shipped, data never arrived" shape this platform keeps hitting — it
// builds green and returns empty in the deployed image. A template
// literal cannot fail to be there. One copy, importable, still
// readable by a human. Same reasoning as x-codex.ts.
//
// EVERY RULE CARRIES A VERIFICATION STATE. Rules gathered from
// secondary sources are hypotheses with a date on them, not facts.
//   verified: true  → may drive a HARD gate (blocks a draft)
//   verified: false → may only drive a WARNING or guidance
// scripts/copy/check-codex.mjs walks this file and fails CI on a
// hard-gated guess.
//
// REFRESH: quarterly. Owner: the reddit-copywriter subagent.
// Next due 2026-11-27.

export const CODEX_VERSION = '2026-08-27.0';

export interface CodexRule {
  id: string;
  rule: string;
  verified: boolean;
  verifiedOn: string | null;
  source: string;
  enforcement: 'hard' | 'warn' | 'guidance';
}

// The machine-readable register. craft-lints.ts enforces the ids
// marked hard/warn; the prompt in voice.ts renders every hard rule in
// the same words the linter uses.
export const CODEX_RULES: CodexRule[] = [
  {
    id: 'self-post-only',
    rule: 'Never a link post. The artifact is a text (self) post and the URL lives inside its body, never in the title.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House decision 2026-08-27. The removal-rate rationale from secondary sources is separately unverified and does not carry the rule.',
    enforcement: 'hard',
  },
  {
    id: 'title-hard-limit',
    rule: 'The title is at most 300 characters. That is the platform limit, and the schema enforces it at generation time.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'Reddit platform limit, trivially checkable.',
    enforcement: 'hard',
  },
  {
    id: 'title-band',
    rule: 'Aim for 60-80 characters and front-load the specific noun; mobile truncates long titles.',
    verified: false,
    verifiedOn: '2026-08-27',
    source: 'Secondary, 2026-08-27. Never checked against our own posts — we have published none on Reddit.',
    enforcement: 'warn',
  },
  {
    id: 'no-url-in-title',
    rule: 'No URL in the title. The replay URL belongs in the body of the self post.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'Follows mechanically from self-post-only.',
    enforcement: 'hard',
  },
  {
    id: 'no-coordinate-title',
    rule: 'Never open the title on a bare latitude/longitude pair. Nobody knows where (35.0, 125.0) is. Open on the named facilities, the country, or the sea — all of which the evidence already contains.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'Measured on our own X production data: 223 of 254 drafts (87.8%) opened on a raw coordinate pair, because the mechanical headline is one. Reddit titles draw from the same headline feed; the house rule extends unchanged.',
    enforcement: 'hard',
  },
  {
    id: 'body-carries-the-method',
    rule: 'The body carries at least 150 words of genuine method: what the instrument saw, the observation window, the baseline it was measured against, the sample size where one exists.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'Verified as OUR rule — a house decision. The specific figure of 150 is secondary and the floor, not the aim.',
    enforcement: 'hard',
  },
  {
    id: 'disclose-affiliation',
    rule: 'Affiliation is stated in the body, in plain words, above the link. It is its own schema field so a lint can prove it survived into the final body.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule.',
    enforcement: 'hard',
  },
  {
    id: 'state-the-limit',
    rule: 'A paragraph states what the observation does NOT establish — no confirmed cause, no ground truth, a detection is an instrument reading and not an event. Its own schema field, 1-3 sentences.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'Onboarding brief §14.8 — honesty about a thin feed is the strongest opener to a specialist in that feed. Learned in real outreach.',
    enforcement: 'hard',
  },
  {
    id: 'one-subreddit-per-artifact',
    rule: 'One artifact targets one community. A second community gets a different write, not a crosspost of this one.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule.',
    enforcement: 'hard',
  },
  {
    id: 'allowlist-only',
    rule: 'The target subreddit comes from the checked-in allowlist and must be an APPROVED entry. A draft naming a community that is not an approved entry fails its craft lint. An empty approved set is a valid state: the writer then drafts nothing.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule; docs/copywriters/subreddit-allowlist.md is the source document and this file is its checked-in encoding.',
    enforcement: 'hard',
  },
  {
    id: 'flair',
    rule: 'Where the allowlist entry records a required flair, the draft names that flair. Fires only when the targeted entry requires one.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule; per-sub flair requirements live on the allowlist entries and are recorded when the founder reads the rules.',
    enforcement: 'hard',
  },
  {
    id: 'name-a-source',
    rule: 'Name at least one instrument or feed by name — NASA Black Marble, FIRMS, GDELT, AIS, EIA. "Our data" is not a source.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'The eYKON voice codes (Newsjacking SOP §4, "cite or admit ignorance"). A house rule, not a Reddit practice.',
    enforcement: 'warn',
  },
  {
    id: 'no-repeat-title',
    rule: 'Do not open the title the way recent posts opened. At the SOP cadence, two posts with the same opening is a visible tic.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'Follows from the SOP cadence target of 4-8 events per 90 days.',
    enforcement: 'warn',
  },
  {
    id: 'ninety-ten',
    rule: 'At most 1 in 10 of the account contributions is our own material. Constrains the ACCOUNT and its cadence, not the copy — it lives in the founder runbook, not in a lint.',
    verified: false,
    verifiedOn: '2026-08-27',
    source: 'Secondary, plus the published spirit of the Reddit self-promotion guidance. Not machine-checkable from a draft.',
    enforcement: 'guidance',
  },
  {
    id: 'account-gates',
    rule: 'Karma and account-age thresholds are per-sub AutoMod configuration, usually unpublished. Expect silent removals on a young account; that is an account posture problem, not a copy problem.',
    verified: false,
    verifiedOn: '2026-08-27',
    source: 'Observed bands, 2026-08-27. Unpublished by the communities themselves.',
    enforcement: 'guidance',
  },
];

// ─── THE SUBREDDIT ALLOWLIST ─────────────────────────────────────
//
// Checked-in encoding of docs/copywriters/subreddit-allowlist.md.
// ZERO entries are approved, and that is a valid state, not a defect:
// with no approved destination the writer refuses to produce a
// post-shaped draft (assemble returns null; the compose loop degrades
// to the deterministic template, whose target reads UNASSIGNED and is
// visibly not postable).
//
// A PROPOSED entry is not a destination. It becomes 'approved' only
// after the founder personally reads the community rules and records
// the date, the self-promo policy, the AI-content policy and any
// required flair. Where a community forbids AI-generated content the
// entry becomes comment-only or excluded — never disguised (§11.1).
// An entry whose rules were last read more than a quarter ago goes
// stale and is downgraded, not quietly kept.

export interface SubredditEntry {
  /** Bare slug, no r/ prefix — 'OSINT', not 'r/OSINT'. */
  slug: string;
  status: 'approved' | 'comment-only' | 'excluded' | 'proposed';
  /** Date the founder personally read the community rules; null until then. */
  rulesReadOn: string | null;
  selfPromoPolicy: string | null;
  aiContentPolicy: string | null;
  flairRequired: string | null;
  notes: string;
}

export const SUBREDDIT_ALLOWLIST: SubredditEntry[] = [
  {
    slug: 'OSINT',
    status: 'proposed',
    rulesReadOn: null,
    selfPromoPolicy: null,
    aiContentPolicy: null,
    flairRequired: null,
    notes: 'Method-first culture fits the body-carries-the-method rule. Founder must read: self-promo policy, AI policy, flair.',
  },
  {
    slug: 'geopolitics',
    status: 'proposed',
    rulesReadOn: null,
    selfPromoPolicy: null,
    aiContentPolicy: null,
    flairRequired: null,
    notes: 'Large; strict sourcing standards; likely comment-only at best.',
  },
  {
    slug: 'CredibleDefense',
    status: 'proposed',
    rulesReadOn: null,
    selfPromoPolicy: null,
    aiContentPolicy: null,
    flairRequired: null,
    notes: 'High bar, exactly our register; verify whether original analysis posts are allowed at all.',
  },
  {
    slug: 'energy',
    status: 'proposed',
    rulesReadOn: null,
    selfPromoPolicy: null,
    aiContentPolicy: null,
    flairRequired: null,
    notes: 'Fits the commodities/outage beat; policy unread.',
  },
];

export function approvedSubreddits(): SubredditEntry[] {
  return SUBREDDIT_ALLOWLIST.filter((e) => e.status === 'approved');
}

// The prose codex, rendered into the system prompt. Kept adjacent to
// the register above so the two cannot drift.
export const REDDIT_CODEX = `
THE ARTIFACT
A Reddit self post, never a link post. Five parts, each its own field:
the target subreddit, the title, the body, the affiliation disclosure,
and the limit paragraph. The URL lives inside the body.

THE TITLE
Read in a feed, on a phone, by someone who has never heard of us.
  · At most 300 characters — the platform wall. Aim 60-80 and
    front-load the specific noun; mobile truncates.
  · Open on what was observed and where, in words a human uses.
    Named facilities. A country. A sea. Never a coordinate pair.
  · No URL, no hashtag, no emoji, no exclamation mark, no clickbait
    withholding — the title states the observation, it does not tease it.

THE BODY
Reddit rewards method, not reach. The reader you are writing for
moderates the comments you will get.
  · At least 150 words of genuine method: what the instrument saw, the
    observation window, the baseline it was measured against, the
    sample size where one exists.
  · Markdown, short paragraphs. Name every instrument — NASA Black
    Marble, FIRMS, GDELT, AIS, EIA. "Our data" is not a source.
  · The replay URL appears exactly once, unaltered.
  · The disclosure and the limit paragraph are written as their own
    fields and land in the body above the link — a lint proves both
    survived.

THE DISCLOSURE
One plain line of affiliation. "I built eYKON, the platform that
produced this detection." Not a footnote, not small print, not implied.
It sits above the link so nobody reaches the URL before the interest
is declared.

THE LIMIT PARAGRAPH
One to three sentences on what the observation does NOT establish. No
confirmed cause, no ground truth, a hot pixel is not a fire. This is
the house move and its most credible one: honesty about a thin signal
is the strongest opener to a specialist in that signal.

THE COMMUNITY
  · One artifact, one community. A second community gets a different
    write.
  · The target comes from the approved allowlist only. A PROPOSED
    entry is not a destination; an empty approved list means no draft,
    and that is the correct output, not a failure to route around.
  · The 90/10 rule and account karma gates constrain the ACCOUNT, not
    the copy — they are founder runbook material and no draft fixes
    them.

WHAT THIS IS NOT
  · Not marketing. A reader who never clicks must still come away with
    real intelligence.
  · Not a claim the evidence does not carry. If the analysis says the
    signal is noise, the post says the signal is noise.
  · Not clever at the cost of precision. If the sharper sentence is
    less exactly true, the duller sentence wins. Every time.
`.trim();
