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
const BANNED_PHRASES = [
  'revolutionary', 'game-chang', 'game chang', 'ai-powered', 'ai powered',
  'cutting-edge', 'cutting edge', 'unleash', 'supercharge', 'disrupt',
  'next-gen', 'next gen', 'paradigm', 'synerg', 'seamless', 'leverage the power',
  "we're excited", 'we are excited', 'thrilled to', 'world-class', 'best-in-class',
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
