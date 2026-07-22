// ─── AI ANALYST v2 — model configuration (brief §8.7) ───────────
//
// SINGLE SOURCE OF TRUTH for every model id the analyst calls.
// Founder decision 2026-07-22: a model swap must be a config change,
// not a code hunt. No literal model string may appear anywhere else
// in the analyst path (engine, /api/chat, /api/analyst/*, run.ts,
// auto-title). The UI badge renders the value the server reports, so
// it can never mislabel again.
//
// Env overrides (optional — defaults below apply when unset):
//   ANALYST_MODEL          default interactive model
//   ANALYST_DEEP_MODEL     "Deep Analysis" mode (Pro+ only, §9.6)
//   ANALYST_UTILITY_MODEL  background calls: titles, summaries, tags
//
// Decided set (brief §8.6): Sonnet 5 default / Opus 4.8 deep /
// Haiku 4.5 utility.

export const DEFAULT_ANALYST_MODEL =
  process.env.ANALYST_MODEL || 'claude-sonnet-5';

export const DEEP_ANALYSIS_MODEL =
  process.env.ANALYST_DEEP_MODEL || 'claude-opus-4-8';

export const UTILITY_MODEL =
  process.env.ANALYST_UTILITY_MODEL || 'claude-haiku-4-5';

// Models a session row may carry. Anything else is rejected on write.
export function allowedSessionModels(): string[] {
  return [DEFAULT_ANALYST_MODEL, DEEP_ANALYSIS_MODEL];
}

// Human label for the UI badge. Derived from the id so a config swap
// updates the badge automatically; falls back to the raw id rather
// than ever showing a stale hardcode.
export function modelLabel(modelId: string): string {
  const known: Array<[RegExp, string]> = [
    [/^claude-sonnet-5/, 'Sonnet 5'],
    [/^claude-opus-4-8/, 'Opus 4.8'],
    [/^claude-haiku-4-5/, 'Haiku 4.5'],
    [/^claude-sonnet-4-6/, 'Sonnet 4.6'],
    [/^claude-sonnet-4-5/, 'Sonnet 4.5'],
    [/^claude-opus-4-7/, 'Opus 4.7'],
  ];
  for (const [re, label] of known) {
    if (re.test(modelId)) return label;
  }
  return modelId;
}

// Output budget per leg of the agentic loop. Sonnet 5 runs adaptive
// thinking by default and its tokenizer counts ~30% more tokens than
// Sonnet 4.5, so the old 4096 would truncate — 8192 gives headroom
// for thinking + the answer without risking route timeouts.
export const ANALYST_MAX_TOKENS = 8192;

// Tool-use loop cap, unchanged from v1 behaviour.
export const ANALYST_MAX_ITERATIONS = 5;
