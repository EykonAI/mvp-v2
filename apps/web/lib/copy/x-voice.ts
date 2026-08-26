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
// This platform writes about strikes, outages and sanctions. Real
// people are inside a material share of these events. Playfulness is
// SUPPRESSED — not softened — when the evidence involves violence.
//
// Enforced here on the prompt AND re-checked on the output in
// x-craft-lints.ts. Two gates, because a model that is told to be
// engaging will occasionally find a way to be engaging about a
// casualty, and one gate is not enough for that failure mode.

export const HARM_NEEDLES = [
  'strike', 'struck', 'missile', 'shelling', 'shelled', 'casualt',
  'killed', 'fatalit', 'wounded', 'civilian', 'bomb', 'airstrike',
  'attack', 'assault', 'fighting', 'siege', 'massacre', 'refugee',
  'displaced', 'militant', 'insurgen', 'hostage', 'war ', 'warfare',
];

// Prefix-anchored so 'casualt' catches casualty/casualties and 'attack'
// catches attacked/attacks, while a needle cannot match mid-word.
const HARM_RE = new RegExp(`\\b(?:${HARM_NEEDLES.map((n) => n.trim()).join('|')})`, 'i');

export function harmRegisterForced(ev: Evidence): boolean {
  if ((ev.domain ?? '').toLowerCase() === 'conflict') return true;

  // THE LANGUAGE CHECK RUNS ON EVERY EVENT, AT EVERY SEVERITY.
  //
  // It used to run only when severity was 'high'. That was a defect, found
  // by the dry-run recompose on 2026-08-26: a convergence whose analyst line
  // read "GDELT confirms an active US-Iran-Israel conflict spike
  // (fighting/assault events across Tehran, the Ahvaz area, and Iraq)"
  // carried domain 'Convergence' and severity 'medium', so the gate never
  // engaged and a shooting war got the 'dry' register. The copy that came
  // out happened to be sober. It got lucky, and this gate exists precisely
  // so that it does not have to be.
  //
  // Measured at the time: 31 drafted events carried casualty language while
  // the gate would not have fired.
  //
  // Severity is a statement about SIGNAL STRENGTH — how far the sensor moved
  // — not about whether people are being hurt. It was never the right key.
  //
  // FALSE POSITIVES ARE CHEAP AND DELIBERATE. 'strike' also means strike
  // price and labour strike; 'attack' also means attack surface. The cost of
  // a false positive is one duller post. The cost of a false negative is
  // being flippant about people being killed, in public, from an account
  // whose entire pitch is judgement. Those are not comparable, so this
  // matches broadly on purpose. Do not narrow it to reduce noise.
  return HARM_RE.test(`${ev.headline} ${ev.analystLine}`);
}

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
      : 'This region is NOT live-covered on the current tier. You MUST frame it analytically. You may NOT imply we are watching it live, in any wording.';

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
export const WRITE_THREAD_TOOL = {
  name: 'write_thread',
  description: 'Return the finished X thread as an ordered array of posts.',
  input_schema: {
    type: 'object' as const,
    properties: {
      posts: {
        type: 'array' as const,
        minItems: 3,
        maxItems: 6,
        items: { type: 'string' as const, maxLength: 265 },
        description:
          'The thread, in order. Post 1 is the lead and carries no URL. The last post carries the live-view URL exactly once.',
      },
    },
    required: ['posts'],
  },
};
