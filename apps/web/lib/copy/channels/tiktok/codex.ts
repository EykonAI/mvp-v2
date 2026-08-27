// ─── THE TIKTOK CRAFT CODEX ──────────────────────────────────────
//
// Faithful conversion of docs/copywriters/tiktok-codex.draft.md
// (PR-0, 2026-08-27) into the versioned artifact the RUNTIME reads.
// Authored and owned by the tiktok-copywriter subagent
// (.claude/agents/tiktok-copywriter.md), which is where the skills
// actually load; nothing here is fetched or learned at run time.
//
// THE ARTIFACT IS A SCRIPT PACKAGE A HUMAN RECORDS — hook, beats with
// shots, voiceover, caption, hashtags, limit beat, lockup — never a
// post a cron publishes. The Content Posting API is unaudited and
// SELF_ONLY; publishing is Kef, holding a phone.
//
// Same .ts-not-.md reasoning as x-codex.ts: a runtime fs.readFile of
// markdown inside a Next server bundle is the exact "code shipped,
// data never arrived" shape this platform keeps hitting. A template
// literal cannot fail to be there.
//
// EVERY RULE CARRIES A VERIFICATION STATE, same contract as X:
//   verified: true  → may drive a HARD gate (blocks a draft)
//   verified: false → may only drive a WARNING
// scripts/copy/check-codex.mjs walks this file and fails CI on a
// hard-gated guess.
//
// TWO DRAFT ROWS COULD NOT BE ENCODED AS SINGLE ENFORCEMENT VALUES
// and are split rather than silently flattened:
//   · hook-first was "hard on structure, warn on length" → hook-first
//     (hard, structure) + hook-budget (warn, length; the 90-char budget
//     binds in the tool schema, like the X lead).
//   · subtitles-burned-in was "hard on presence, warn on density" →
//     subtitles-burned-in (hard, presence) + the existing
//     onscreen-text-density row (warn).
//   · sound-policy was "hard under harm, warn otherwise" → encoded
//     'warn'; the harm section of the craft lint escalates the same
//     check to a violation when harmRegisterForced, which is also what
//     no-shaping-under-harm states.
//
// REFRESH: quarterly, and after any visible TikTok ranking or policy
// change. Owner: the tiktok-copywriter subagent. Next due 2026-11-27.

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
// marked hard/warn; the prompt in voice.ts renders the hard ones in
// the same words.
export const CODEX_RULES: CodexRule[] = [
  {
    id: 'recordable-in-one-take',
    rule: 'Every shot is a screen recording of a real eYKON view (GLOBE view or layer, INTEL workspace, /start, the /c replay page, an evidence panel) or a plain talking head. No B-roll, no stock, no chart that does not exist in the product.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule (PR-0 draft codex). The founder records these alone; a shot that cannot be produced in one take is a script that never becomes a video.',
    enforcement: 'hard',
  },
  {
    id: 'hook-first',
    rule: 'No greeting, no introduction, no context-setting; the first line is the observation, spoken and on screen.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House structural rule (PR-0 draft codex). The reported first-2-seconds retention figure is secondary and is not what this gate rests on.',
    enforcement: 'hard',
  },
  {
    id: 'hook-budget',
    rule: 'The hook is 90 characters, spoken AND on-screen. The schema enforces the budget at generation time; the lint warns as the second reading.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House budget, split from the draft hook-first row which read hard on structure, warn on length. Same shape as the X lead-ceiling rule.',
    enforcement: 'warn',
  },
  {
    id: 'no-clickable-link',
    rule: 'No URL in the caption. The CTA is the spoken/on-screen path eykon.ai/start/tiktok — a caption link is not clickable on TikTok, and a path segment survives the privacy browsers that strip utm parameters, by construction.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule (PR-0 draft codex), composing with the path-attribution design in lib/attribution.',
    enforcement: 'hard',
  },
  {
    id: 'caption-budget',
    rule: 'Caption at most 2,200 characters, primary phrase inside the first ~150.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House budget (PR-0 draft codex). Conflict recorded there: one skill reference says 4,000 — resolve against TikTok docs before hard-gating the higher figure.',
    enforcement: 'hard',
  },
  {
    id: 'hashtags-max-5',
    rule: 'At most 5 hashtags; 3 to 5 is the working range.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House budget (PR-0 draft codex); the numeric limit is reported since Aug 2025 but the budget is verified as OURS.',
    enforcement: 'hard',
  },
  {
    id: 'lockup-and-end-card',
    rule: 'Every script names the lower-third lockup, present throughout — eYKON wordmark, feed name, observation timestamp UTC, provenance state — and an end card carrying the path CTA eykon.ai/start/tiktok and nothing competing with it. A script with beats but no frame furniture is not recordable as specified.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'The brief 11.2 furniture invariant, on the one channel where the asset IS the video.',
    enforcement: 'hard',
  },
  {
    id: 'subtitles-burned-in',
    rule: 'Every spoken line has a burned-in subtitle: every beat carries a non-empty on-screen line. Most viewing is muted.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule (PR-0 draft codex), hard on presence; the density figures are secondary and live in onscreen-text-density.',
    enforcement: 'hard',
  },
  {
    id: 'sound-policy',
    rule: 'Spoken voiceover by default. A trending sound is permitted only where it does not shape the meaning; under the harm register it is forbidden outright and the harm section of the lint blocks it.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule (PR-0 draft codex). Draft enforcement read hard under harm, warn otherwise; encoded warn here with the hard branch in the harm output check.',
    enforcement: 'warn',
  },
  {
    id: 'onscreen-text-density',
    rule: 'At most 2 lines of overlay text at once, 3 to 5 words per line.',
    verified: false,
    verifiedOn: null,
    source: 'Secondary craft guidance, never measured on our own videos.',
    enforcement: 'warn',
  },
  {
    id: 'length-band',
    rule: 'Voiceover targets 55 to 90 words, which reads as 21 to 34 seconds; 15 to 30 seconds reportedly completes best.',
    verified: false,
    verifiedOn: null,
    source: 'Secondary: 2026 completion-rate write-ups. We have zero published videos to check against.',
    enforcement: 'warn',
  },
  {
    id: 'keyword-in-four-places',
    rule: 'Primary phrase appears in the voiceover, an overlay, the caption, and the hashtags.',
    verified: false,
    verifiedOn: null,
    source: 'Secondary TikTok-SEO guidance, unmeasured.',
    enforcement: 'guidance',
  },
  {
    id: 'state-the-limit',
    rule: 'A dedicated beat for what the observation does not establish — in the video, not a caption line.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule; onboarding brief 14.8 — honesty about a thin feed is the strongest opener to a specialist in that feed.',
    enforcement: 'hard',
  },
  {
    id: 'no-shaping-under-harm',
    rule: 'Harm register forced: no trending sound, no shaped hook, no withheld reveal, no countdown, no question. The video states what was observed and stops.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House rule — the strictest form of the shared harm rule in lib/copy/shared/harm.ts.',
    enforcement: 'hard',
  },
  {
    id: 'no-inbound-formats',
    rule: 'Duets, stitches and reply-videos are out of scope: they are inbound-reactive, and this writer is write-only by the same boundary as Discord.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'House structural rule (PR-0 draft codex).',
    enforcement: 'hard',
  },
  {
    id: 'name-a-source',
    rule: 'The instrument is named ON SCREEN — in the hook, an overlay, or the lower-third lockup — not only spoken.',
    verified: true,
    verifiedOn: '2026-08-27',
    source: 'The eYKON voice codes (Newsjacking SOP 4, cite or admit ignorance), applied to the muted viewer.',
    enforcement: 'warn',
  },
  {
    id: 'cadence-mismatch',
    rule: 'TikTok ranking assumes near-daily posting; the SOP supplies 4 to 8 events a quarter. A runbook fact, not a lint — the founder decides whether the account exists at all.',
    verified: false,
    verifiedOn: null,
    source: 'Secondary: 2026 cadence write-ups against the Newsjacking SOP cadence target.',
    enforcement: 'guidance',
  },
];

// The prose codex, rendered into the system prompt. Kept adjacent to
// the register above so the two cannot drift.
export const TIKTOK_CODEX = `
THE ARTIFACT
You are writing a SCRIPT PACKAGE a human records in one take, not a
post. Hook, beats with shots, voiceover, caption, hashtags, a limit
beat, and the frame furniture. If a beat cannot be produced by
screen-recording a real eYKON view or pointing a phone at a face, it
does not belong in the script.

THE HOOK
Spoken and on screen at once, 90 characters. It is the observation,
stated — no greeting, no introduction, no "in this video". The format
supplies the energy; the hook supplies the fact.
  WHAT FITS (real hooks, under budget):
    "Three Kuwaiti power facilities went dark on satellite. No news
     reported it. It was real."                                    (89)
    "Two satellite sensors flagged the same Sicilian refinery this
     week. Here is what they saw."                                 (88)

THE BEATS
Four to seven. Each beat is three things: an overlay line of at most
five words (the burned-in subtitle — most viewing is muted), the
spoken line, and the shot. The shot names a REAL eYKON screen —
GLOBE view or layer, INTEL workspace, /start, the /c replay page, an
evidence panel — or 'talking head'. One beat is the limit beat: what
this observation does NOT establish, said in the video.

THE VOICEOVER
The full script as read, 55 to 90 words — 21 to 34 seconds spoken.
Plain sentences. One specific, checkable number beats every adjective.
Name the instrument out loud AND on screen.

THE CAPTION
Primary phrase inside the first ~150 characters, then sourcing, then
the limit. NO URL anywhere in it — a caption link is not clickable and
the privacy browsers strip utm parameters anyway. The CTA is the
spoken and on-screen path eykon.ai/start/tiktok, which survives both.
At most five hashtags.

THE FURNITURE
The lower third is on screen THROUGHOUT: eYKON wordmark, feed name,
observation timestamp UTC, provenance state. The end card carries the
path CTA and nothing competing with it. The video IS the asset; a
script without its furniture is not recordable as specified.

WHAT THIS IS NOT
  · Not a content-farm video. No trending-sound bait, no withheld
    reveal, no countdown, no "wait for it".
  · Not inbound: no duets, no stitches, no reply-videos.
  · Not a claim the evidence does not carry. If the analysis says the
    signal is noise, the video says the signal is noise.
  · Not clever at the cost of precision. If the sharper line is less
    exactly true, the duller line wins. Every time.
`.trim();
