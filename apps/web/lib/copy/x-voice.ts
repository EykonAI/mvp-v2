// ─── THE eYKON X VOICE ───────────────────────────────────────────
//
// THE single source of truth for how eYKON sounds on X. No prompt
// text lives anywhere else — same discipline as lib/analyst/model.ts
// for model ids, and for the same reason: a voice hardcoded in four
// places drifts in four directions.
//
// The register dial is a founder decision (COPYWRITER_REGISTER), and
// the harm rule overrides it unconditionally.

import { X_CODEX, CODEX_RULES, CODEX_VERSION } from '@/lib/copy/x-codex';
import { LIVE_CLAIM_NEEDLES } from '@/lib/newsjack/coverage';
import { harmRegisterForced } from '@/lib/copy/shared/harm';
import type { Evidence } from '@/lib/newsjack/template';

export { CODEX_VERSION };

export type Register = 'flat' | 'dry' | 'open';

export function currentRegister(): Register {
  const v = (process.env.COPYWRITER_REGISTER ?? 'dry').toLowerCase();
  return v === 'flat' || v === 'open' ? v : 'dry';
}

export function copywriterEnabled(): boolean {
  const v = (process.env.NEWSJACK_COPYWRITER ?? '').toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

// ─── The harm rule ───────────────────────────────────────────────
//
// MOVED to lib/copy/shared/harm.ts in the multi-channel foundation —
// one needle list, one forced-register rule, every channel. Re-exported
// here so existing imports (x-composer, x-craft-lints, tests) keep
// working; check-harm-gate.mjs now reads the shared module.

export { HARM_NEEDLES, harmRegisterForced } from '@/lib/copy/shared/harm';

const REGISTER_GUIDANCE: Record<Register, string> = {
  flat: `
REGISTER — FLAT.
Plain, precise, sourced. No rhetorical shaping of any kind. No wit, no
rhythm play, no shaped hook. State what was observed, by what
instrument, what it means and what it does not. This is the register
of a situation report, and it is the correct one whenever the subject
could be read as harm.`.trim(),

  dry: `
REGISTER — DRY.
Understatement is permitted and preferred. The wit is in the placement
of a true detail against an expectation, never in a joke. "Three power
plants, three cloudless nights, one monotonic collapse. No news input."
is the register: it contains no joke and it is not flat.
Permitted: a short sentence after a long one; a fragment where a
fragment lands; the deadpan number.
Not permitted: irony about the subject, cleverness that costs
precision, anything a senior analyst would wince at.`.trim(),

  open: `
REGISTER — OPEN.
As DRY, plus a deliberately shaped opening and varied post lengths
across the thread. The lead may be built for the scroll — a stated
observation that creates a real question the thread then answers.
Still no emoji, no exclamation mark, no hype, no rhetorical questions
as filler, no "let me explain". The shaping is in structure and
rhythm, never in volume.`.trim(),
};

// EVERY HARD LINT MUST BE STATED IN THE PROMPT IT JUDGES.
//
// This clause used to say "no rhetorical shaping" and leave it there,
// while the output check silently rejected any thread containing a
// QUESTION MARK. Meanwhile the codex tells the writer to "leave
// something a knowledgeable reader can answer or contest" and carries
// an invite-a-reply rule. So the prompt asked for a question, the
// linter banned it without saying so, and the composer looped: write
// question, rejected, write question, rejected, fall back to template.
//
// Found on 2026-08-26 by the retry instrumentation, on a GDELT
// China/Taiwan "Fight/Assault" convergence — the first fallback the
// copywriter ever produced, and it was deterministic rather than
// unlucky. A gate that enforces an unstated rule does not correct the
// model, it just exhausts the retry budget.
//
// The ban itself is kept: in a flat report about people being hurt, a
// question is a rhetorical device and does not belong. What changes is
// that the writer is now TOLD, in the same words the linter uses.
const HARM_CLAUSE = `
HARM OVERRIDE IS ACTIVE FOR THIS EVENT.
The evidence involves conflict or possible casualties. Ignore the
register above and write FLAT: plain, precise, sourced, no rhetorical
shaping at all. Do not reach for a hook. Do not look for the wry detail.

CONCRETELY, IN THIS REGISTER — these are enforced by a linter and a
thread that breaks one is discarded:
  · NO QUESTIONS. Not one question mark anywhere in the thread. The
    usual instruction to leave something a reader can answer does NOT
    apply here; end on the statement instead.
  · No "imagine", "here's the thing", "turns out", "plot twist",
    "spoiler", "wild", "buckle".
  · No shaped opening. State what was observed, by which instrument,
    and what it does and does not establish.

Ask of every sentence: would this read as flippant to someone directly
affected by the event it describes? If the answer is anything other
than a confident no, write it flatter.`.trim();

const VOICE_CODES = `
THE eYKON VOICE CODES (Newsjacking SOP §4 — build requirements, not
style preferences):
  · Founder/analyst tone. You are writing to a senior analyst who will
    laugh at you if you overreach.
  · No emojis. No exclamation marks. English only.
  · Dense. Numbers and proper nouns are load-bearing.
  · No buzzwords. No "revolutionary", "game-changing", "AI-powered",
    "cutting-edge", "unleash", "supercharge", "seamless", "thrilled".
  · Cite or admit ignorance. Every claim carries a source. If the data
    is not there, the post says so.
  · Never claim coverage eYKON does not have.
  · Real value to a non-customer, on its own, before it asks anything.
`.trim();

// `override` lets a caller compose at a specific register without changing
// the deployed default — used by the dry-run recompose so all three can be
// compared side by side. The harm rule still wins over any override: it is
// not a preference, and a caller may not opt out of it.
export function systemPrompt(ev: Evidence, override?: Register): string {
  const register = harmRegisterForced(ev) ? 'flat' : (override ?? currentRegister());
  return [
    'You are the eYKON.ai X copywriter. You turn a verified intelligence',
    'evidence package into a short X thread that a senior analyst would',
    'read to the end. You are not a marketer. The evidence is the product;',
    'your job is to make it land without inflating it by one degree.',
    '',
    VOICE_CODES,
    '',
    X_CODEX,
    '',
    REGISTER_GUIDANCE[register],
    ...(harmRegisterForced(ev) ? ['', HARM_CLAUSE] : []),
    '',
    `THE LEAD HAS A HARD BUDGET OF ${LEAD_MAX_CHARS} CHARACTERS. The write_thread`,
    'tool takes it as its own field for that reason. Count the characters.',
    'Aim well under it — the lead is one idea, and if it will not fit, the',
    "lead is doing the body's job. Move something into post 2.",
    '',
    `CODEX VERSION ${CODEX_VERSION}. The hard rules below are enforced by a`,
    'linter after you write. A thread that breaks one is discarded:',
    ...CODEX_RULES.filter((r) => r.enforcement === 'hard').map((r) => `  · ${r.rule}`),
  ].join('\n');
}

// The evidence goes in as STRUCTURED FIELDS, never as prose the model
// has to parse back out. The coverage verdict is an instruction, not a
// hint: the writer never decides whether we can say "live".
export function userPrompt(ev: Evidence, refUrl: string): string {
  const framingRule =
    ev.framing === 'live'
      ? 'This region IS live-covered on the current tier. You may say the observation is live on eYKON.'
      : [
          'This region is NOT live-covered on the current tier. You MUST frame it analytically.',
          'You may name the region; what you may not do is pair it with live-coverage phrasing.',
          `These exact phrases are checked by a linter and NONE may appear anywhere in your output: ${LIVE_CLAIM_NEEDLES.map((n) => `"${n}"`).join(', ')}.`,
          'Say what the instruments recorded and when; do not say we are watching it now.',
        ].join(' ');

  return [
    'Write the X thread for this event.',
    '',
    '── EVIDENCE ──',
    `domain:      ${ev.domain ?? 'unspecified'}`,
    `region:      ${ev.region ?? 'unspecified'}`,
    `severity:    ${ev.severity ?? 'unspecified'}`,
    `sources:     ${ev.sources.length ? ev.sources.join(', ') : 'none extracted — name the instruments the analysis itself mentions'}`,
    '',
    'analyst finding (the substance — this is what you are conveying):',
    ev.analystLine,
    '',
    'existing mechanical headline (for reference only — it is usually a',
    'coordinate pair and you should NOT reuse it):',
    ev.headline,
    '',
    '── RULES FOR THIS EVENT ──',
    framingRule,
    '',
    `The FINAL post must contain this URL exactly once, unaltered: ${refUrl}`,
    'Do not shorten it, do not add parameters, do not wrap it in markdown.',
    'No other post may contain any URL.',
    '',
    'If the analyst finding says the signal is routine, ambiguous or noise,',
    'SAY SO plainly. A post that tells a reader something is nothing is a',
    'good post and we publish those.',
    '',
    'Return 3 to 6 posts, each at most 265 characters, via the write_thread tool.',
  ].join('\n');
}

// Forced-tool schema. The engine must never regex a model's prose —
// same pattern as the NOTIF AI evaluator.
// THE LEAD IS ITS OWN FIELD, WITH ITS OWN BUDGET.
//
// It used to be posts[0] of a string[] whose items were all maxLength
// 265. So the only length the model could actually see expressed was
// 265, and the 150 ceiling lived in prose. It optimised to the number
// in the schema, exactly as you would expect: measured across three dry
// runs, EVERY lead came in over — 153, 158, 162, 164, 166, 172, 174,
// 178, 184, 188, 190, 191, 194. Not one under. That is not the model
// ignoring an instruction, that is an instruction that was never
// binding competing with one that was.
//
// Splitting the field puts the budget where it binds. The lint stays a
// WARNING rather than becoming a gate: a style rule that forces a retry
// costs a model call every time it fires, and tonight's lesson is that
// over-eager gates are expensive. Constrain at generation, measure
// after, block only for honesty.
export const LEAD_MAX_CHARS = 150;

export const WRITE_THREAD_TOOL = {
  name: 'write_thread',
  description:
    'Return the finished X thread: the lead, then the remaining posts in order.',
  input_schema: {
    type: 'object' as const,
    properties: {
      lead: {
        type: 'string' as const,
        maxLength: LEAD_MAX_CHARS,
        description:
          `Post 1. HARD BUDGET ${LEAD_MAX_CHARS} CHARACTERS — count them. One idea, not a summary. ` +
          'Carries no URL. If it will not fit, move the qualifier or the second instrument into the next post rather than compressing this one.',
      },
      rest: {
        type: 'array' as const,
        minItems: 2,
        maxItems: 5,
        items: { type: 'string' as const, maxLength: 265 },
        description:
          'Posts 2 onward, in order. The FINAL entry carries the live-view URL exactly once; no other post may contain a URL.',
      },
    },
    required: ['lead', 'rest'],
  },
};
