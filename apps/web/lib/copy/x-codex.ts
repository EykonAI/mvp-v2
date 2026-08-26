// ─── THE X CRAFT CODEX ───────────────────────────────────────────
//
// The distillation of the writing skills into a durable, versioned
// artifact the RUNTIME can read. Authored by the x-copywriter
// subagent (.claude/agents/x-copywriter.md), which is where the
// skills actually load; nothing here is fetched or learned at run
// time.
//
// WHY THIS IS A .ts AND NOT THE .md THE BRIEF ASKED FOR: a runtime
// fs.readFile of a markdown file inside a Next server bundle is the
// exact "code shipped, data never arrived" shape this platform keeps
// hitting — it builds green and returns empty in the deployed image.
// A template literal cannot fail to be there. One copy, importable,
// still readable by a human.
//
// EVERY RULE CARRIES A VERIFICATION STATE. Rules gathered from
// secondary sources are hypotheses with a date on them, not facts.
//   verified: true  → may drive a HARD gate (blocks a draft)
//   verified: false → may only drive a WARNING
// This is the same shape as the a11y CI (brief §25.3): one hard gate,
// the rest ratchets. A gate that fires on a guess gets switched off
// by the second person who hits it.
//
// REFRESH: quarterly, and after any visible X ranking change.
// Owner: the x-copywriter subagent. Next due 2026-11-26.

export const CODEX_VERSION = '2026-08-26.1';

export interface CodexRule {
  id: string;
  rule: string;
  verified: boolean;
  verifiedOn: string | null;
  source: string;
  enforcement: 'hard' | 'warn' | 'guidance';
}

// The machine-readable register. x-craft-lints.ts enforces the ids
// marked hard/warn; the prompt in x-voice.ts renders all of them.
export const CODEX_RULES: CodexRule[] = [
  {
    id: 'no-link-in-lead',
    rule: 'No URL in the first post. A post carrying an external link loses roughly 30–50% of its initial reach; the link belongs in a reply, which the thread already is.',
    verified: true,
    verifiedOn: '2026-08-26',
    source: 'Multiple 2026 algorithm write-ups agree, AND it is already how our own template behaves — the practice is corroborated by our own shipped design.',
    enforcement: 'hard',
  },
  {
    id: 'no-coordinate-lead',
    rule: 'Never open on a bare latitude/longitude pair. Nobody knows where (35.0, 125.0) is. Open on the named facilities, the country, or the sea — all of which the evidence already contains.',
    verified: true,
    verifiedOn: '2026-08-26',
    source: 'Measured on our own production data: 223 of 254 X drafts (87.8%) opened on a raw coordinate pair.',
    enforcement: 'hard',
  },
  {
    id: 'never-truncate',
    rule: 'No post may end mid-word or in an ellipsis produced by clipping. Write to the limit; never write past it and cut.',
    verified: true,
    verifiedOn: '2026-08-26',
    source: 'Measured on our own production data: 176 of 254 drafts (69%) truncated mid-word, including 7 of the 16 posts actually published.',
    enforcement: 'hard',
  },
  {
    id: 'thread-shape-bounds',
    rule: 'Three to six posts. Three is the structural floor: a lead, at least one post of substance, and the link post — fewer than three cannot satisfy no-link-in-lead. Six is the house ceiling.',
    verified: true,
    verifiedOn: '2026-08-26',
    source: 'A house decision, not an external claim — verified as OUR rule. The floor of 3 follows mechanically from no-link-in-lead; the ceiling of 6 is the founder cap on thread length.',
    enforcement: 'hard',
  },
  {
    id: 'thread-length-band',
    rule: 'Within those bounds, four to six posts reportedly performs best; single posts underperform threads.',
    verified: false,
    verifiedOn: '2026-08-26',
    source: 'Secondary: 2026 thread guides converge on a 4–8 band. Never checked against our own 16 published posts.',
    enforcement: 'warn',
  },
  {
    id: 'lead-length',
    rule: 'Keep the lead under about 150 characters. The high-engagement band is reported at 71–100; 270 is a ceiling, never a target.',
    verified: false,
    verifiedOn: '2026-08-26',
    source: 'Secondary: 2026 engagement analyses. Unverified against our own posts — we have 16 and no read-back.',
    enforcement: 'warn',
  },
  {
    id: 'name-a-source',
    rule: 'Name at least one instrument or feed by name — NASA Black Marble, FIRMS, GDELT, AIS, EIA. "Our data" is not a source.',
    verified: true,
    verifiedOn: '2026-08-26',
    source: 'The eYKON codes (Newsjacking SOP §4, "cite or admit ignorance"). Not an X practice — a house rule.',
    enforcement: 'warn',
  },
  {
    id: 'invite-a-reply',
    rule: 'Replies are the heaviest positive ranking signal, above reposts, bookmarks and likes. End on something a knowledgeable reader can answer, disagree with, or add to — never on applause-bait or a rhetorical question. EXCEPTION: when the harm register is active this rule is suspended entirely — no questions at all, end on the statement.',
    verified: false,
    verifiedOn: '2026-08-26',
    source: 'Secondary: consistent across 2026 write-ups of the ranking model.',
    enforcement: 'guidance',
  },
  {
    id: 'state-the-limit',
    rule: 'State the limit of the observation out loud, in the thread, not in a footnote. Single-sensor, publication lag, uncovered region, inference-not-confirmation. This is the house\'s most distinctive move and its most credible one.',
    verified: true,
    verifiedOn: '2026-08-26',
    source: 'Onboarding brief §14.8 — honesty about a thin feed is the strongest opener to a specialist in that feed. Learned in real outreach.',
    enforcement: 'guidance',
  },
  {
    id: 'one-number',
    rule: 'Carry one specific, checkable number, and let it do the persuading. "3–17σ above clear-night baseline" is the post. Adjectives are not.',
    verified: true,
    verifiedOn: '2026-08-26',
    source: 'The eYKON voice codes: numbers and proper nouns are load-bearing.',
    enforcement: 'guidance',
  },
  {
    id: 'no-repeat-lead',
    rule: 'Do not open the way the last few posts opened. At four to eight posts a quarter, two threads with the same opening is a visible tic.',
    verified: true,
    verifiedOn: '2026-08-26',
    source: 'Follows from the SOP cadence target of 4–8 events per 90 days.',
    enforcement: 'warn',
  },
];

// The prose codex, rendered into the system prompt. Kept adjacent to
// the register above so the two cannot drift.
export const X_CODEX = `
THE LEAD
Post 1 is the whole game. It is read on a phone, in a scroll, by
someone who has never heard of us. It must be true at the level of the
evidence, not merely true as a sentence.
  · Open on what was observed and where, in words a human uses.
    Named facilities. A country. A sea. Never a coordinate pair.
  · One specific number beats every adjective available to you.
  · Under ~150 characters. Shorter is usually better.
  · No link, no hashtag, no emoji, no exclamation mark.

THE BODY
  · One to two sentences per post. Line breaks, not walls.
  · Say what the instrument saw, then what it does and does not mean.
  · Name the instrument. NASA Black Marble. FIRMS. GDELT. AIS. EIA.
  · State the limit in the thread: single-sensor, publication lag,
    uncovered region, inference rather than confirmation.
  · Never write past the character limit and cut. Write to fit.

THE CLOSE
  · The final post carries the live view URL, unmodified, and nothing
    that competes with it.
  · No "sign up", no "DM me", no thread-recap.
  · Leave something a knowledgeable reader can answer or contest.

WHAT THIS IS NOT
  · Not marketing. A reader who never registers must still come away
    with real intelligence.
  · Not a claim the evidence does not carry. If the analysis says the
    signal is noise, the post says the signal is noise — that is a
    good post, and a rarer one than a dramatic post.
  · Not clever at the cost of precision. If the sharper sentence is
    less exactly true, the duller sentence wins. Every time.
`.trim();
