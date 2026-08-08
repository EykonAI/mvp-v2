// ─── Cost metering — the rate card ──────────────────────────────
//
// SINGLE SOURCE OF TRUTH for every USD-per-token figure. No literal
// price may appear anywhere else in the codebase — same discipline as
// lib/analyst/model.ts holds for model ids.
//
// Every cost_events row is stamped with PRICE_VERSION, so a price
// change never retroactively rewrites history.
//
// ⚠️ LIVE PRICE CHANGE PENDING
// Claude Sonnet 5 — the analyst's DEFAULT model — is on introductory
// pricing of $2.00 / $10.00 per MTok THROUGH 2026-08-31. From
// 2026-09-01 it reverts to the standard $3.00 / $15.00, a 50% rise on
// the platform's single largest variable cost. When that lands: add a
// new PRICE_VERSION with the standard rates rather than editing these
// numbers in place, so historical rows keep pricing at what we
// actually paid.
//
// Rates verified against Anthropic published pricing 2026-08-08.

export const PRICE_VERSION = 'anthropic-2026-08-08-sonnet5-intro';

export interface ModelRate {
  /** USD per 1M input tokens (uncached). */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M tokens written to cache (1.25x input, 5-minute TTL). */
  cache_write: number;
  /** USD per 1M tokens read from cache (0.1x input). */
  cache_read: number;
}

// Cache multipliers are API-wide, not per-model:
//   write (5m TTL) = 1.25x input   ·   read = 0.1x input
// The 1h TTL write multiplier is 2x — add a separate entry if the
// analyst ever adopts ttl:'1h' on its cache_control block.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

function rate(input: number, output: number): ModelRate {
  return {
    input,
    output,
    cache_write: input * CACHE_WRITE_MULTIPLIER,
    cache_read: input * CACHE_READ_MULTIPLIER,
  };
}

export const MODEL_PRICES: Record<string, ModelRate> = {
  // Analyst default. INTRO pricing — see the warning above.
  'claude-sonnet-5': rate(2.0, 10.0),
  // Deep Analysis (Pro+ opt-in). 2.5x Sonnet 5's intro input rate and
  // 2.5x its output rate — this is the budget burner the 20% Deep
  // sub-cap exists to bound.
  'claude-opus-4-8': rate(5.0, 25.0),
  // Utility calls: auto-titles.
  'claude-haiku-4-5': rate(1.0, 5.0),
};

/** Accumulated token usage for one analyst turn, summed across every
 *  leg of the tool-use loop. */
export interface AccUsage {
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  legs: number;
}

export class UnknownModelPriceError extends Error {
  constructor(model: string) {
    super(
      `[costs] No rate card for model "${model}" (price_version ${PRICE_VERSION}). ` +
        'Add it to MODEL_PRICES — refusing to price at zero.',
    );
    this.name = 'UnknownModelPriceError';
  }
}

/**
 * Price an accumulated usage record. THROWS on an unknown model id —
 * a silent zero is a free ride that looks like thrift, and it would
 * make an exhausted balance read as healthy.
 */
export function priceUsage(model: string, usage: AccUsage): number {
  const r = MODEL_PRICES[model];
  if (!r) throw new UnknownModelPriceError(model);
  const perToken = 1 / 1_000_000;
  return (
    usage.input_tokens * r.input * perToken +
    usage.output_tokens * r.output * perToken +
    usage.cache_write_tokens * r.cache_write * perToken +
    usage.cache_read_tokens * r.cache_read * perToken
  );
}

/**
 * Worst-case cost of one more turn on this model, used by the
 * pre-flight reserve so the final turn cannot overshoot the budget by
 * a full Opus turn. Assumes max_tokens of output plus a typical
 * cached-prompt input leg; deliberately pessimistic.
 */
export function estimateMaxTurnCost(model: string, maxOutputTokens: number): number {
  const r = MODEL_PRICES[model];
  if (!r) throw new UnknownModelPriceError(model);
  const perToken = 1 / 1_000_000;
  // A tool-heavy turn re-sends the cached prefix per leg; 6 legs is
  // the loop ceiling (1 + ANALYST_MAX_ITERATIONS).
  const TYPICAL_CACHED_PREFIX_TOKENS = 20_000;
  const MAX_LEGS = 6;
  return (
    maxOutputTokens * r.output * perToken +
    TYPICAL_CACHED_PREFIX_TOKENS * MAX_LEGS * r.cache_read * perToken
  );
}
