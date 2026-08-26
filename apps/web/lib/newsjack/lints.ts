import { scanOverclaim } from '@/lib/newsjack/coverage';

// The eYKON codes, enforced as gates (Newsjacking SOP §4, §8). A draft that
// fails any lint is stored as 'blocked', never published. These are mechanical
// checks; "reads as analysis, not marketing" stays the founder's call at
// approval.

export interface LintResult {
  ok: boolean;
  violations: string[];
}

// Buzzwords the founder voice rejects (content brief §6 — "writing to a senior
// analyst who will laugh at you").
// Unambiguous marketing hype. These have no legitimate use in an
// intelligence post, so a plain substring match is safe.
const BANNED_PHRASES = [
  'game-chang', 'game chang', 'ai-powered', 'ai powered',
  'cutting-edge', 'cutting edge', 'supercharge',
  'next-gen', 'next gen', 'paradigm', 'synerg', 'seamless', 'leverage the power',
  "we're excited", 'we are excited', 'thrilled to', 'world-class', 'best-in-class',
];

// ─── The ambiguous ones ──────────────────────────────────────────
//
// Three words on the original list are ALSO ordinary vocabulary on this
// beat, and a substring match cannot tell the two apart.
//
// 'disrupt' was the expensive one. Measured on production 2026-08-26:
// 42 of 252 stored analyst lines contain it, and ALL 42 are the noun or
// verb — supply disruption, shipping disrupted, disrupting throughput.
// Not one was marketing. The ban never caught hype even once; it
// blocked 7 real drafts between 2026-08-09 and 08-21 and, after the
// copywriter shipped, caused 5 of 8 retries in a single dry run. It was
// the platform's second-most-common block reason and every hit was a
// false positive.
//
// 'revolutionary' is a landmine that has simply not gone off yet: the
// Islamic Revolutionary Guard Corps is a named entity this platform
// will write about the moment Iran coverage picks up. Zero occurrences
// so far, which is luck, not safety.
//
// 'unleash' appears in ordinary conflict prose — "unleashed a barrage".
//
// So these three are matched only in their HYPE constructions. The
// principle: a guardrail that fires on correct vocabulary does not
// raise quality, it teaches everyone to route around the guardrail.
const HYPE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bdisrupt(?:ing|s)?\s+the\s+(?:industry|market|space|sector|status quo)\b/i, label: 'disrupt the <industry>' },
  { re: /\bdisruptive\s+(?:technology|innovation|platform|solution)\b/i, label: 'disruptive technology' },
  { re: /\brevolutionary\s+(?!guard)/i, label: 'revolutionary (as a claim)' },
  { re: /\bunleash(?:ing|es|ed)?\s+(?:the\s+power|your|a\s+new\s+era)\b/i, label: 'unleash the power' },
];

// Extended_Pictographic covers emoji without false-positives on dashes/quotes;
// the regional-indicator range catches flag emoji.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;

export function voiceLint(text: string): LintResult {
  const v: string[] = [];
  if (EMOJI_RE.test(text)) v.push('emoji present (none allowed)');
  if (text.includes('!')) v.push('exclamation mark present (none allowed)');
  const lower = text.toLowerCase();
  for (const p of BANNED_PHRASES) if (lower.includes(p)) v.push(`buzzword: "${p}"`);
  // Report the text that actually matched, not the pattern name — a
  // writer told "buzzword: disrupt the <industry>" still has to guess
  // which sentence it was in.
  for (const { re, label } of HYPE_PATTERNS) {
    const m = text.match(re);
    if (m) v.push(`marketing phrasing: "${m[0].trim()}" (${label})`);
  }
  return { ok: v.length === 0, violations: v };
}

export function coverageLint(text: string): LintResult {
  const hits = scanOverclaim(text);
  return {
    ok: hits.length === 0,
    violations: hits.map(
      (r) => `coverage overclaim: ${r} is not live on the current tier — frame analytically`,
    ),
  };
}

// The "real value to users" gate (Newsjacking SOP §13). Mechanical four:
// a sourced insight, a replayable view, no overclaim, clean voice.
export interface ValueInput {
  hasSources: boolean;
  replayUrl: string | null;
  body: string;
}
export function valueTest(input: ValueInput): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.hasSources) reasons.push('no sourced insight (analyst returned no citation / insufficient data)');
  if (!input.replayUrl) reasons.push('no replayable view link');
  const coverage = coverageLint(input.body);
  if (!coverage.ok) reasons.push(...coverage.violations);
  const voice = voiceLint(input.body);
  if (!voice.ok) reasons.push(...voice.violations);
  return { pass: reasons.length === 0, reasons };
}
