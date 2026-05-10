/**
 * Safe logger (PR-S3, see docs/SECURITY_HARDENING_PLAN.md §4).
 *
 * `safeError(message, ctx?)` is a thin wrapper around `console.error`
 * that walks `ctx` recursively and scrubs any property whose KEY matches
 * a known secret pattern (case-insensitive). Values are not inspected —
 * we only redact by key name. This protects against the common
 * footgun of accidentally logging a request body, third-party API
 * response, or webhook payload that happens to contain a credential.
 *
 * When to use:
 *   safeError('[scope] human message', err)        // catch (err: unknown)
 *   safeError('[scope] failed', { row, headers })  // structured context
 *
 * When NOT to use (regular `console.error` is fine):
 *   console.error('[scope] simple string')
 *   console.error('[scope] failed', error.message) // already a string
 *
 * The scrubber only redacts OBJECT KEYS. Strings are passed through
 * untouched. If you need to log a string that itself contains a secret
 * (rare), don't — log the surrounding context with a separate scrubbed
 * key instead. PR-S3 deliberately scopes to key-based scrubbing because
 * value-based heuristics produce false positives at runtime and miss
 * encoded secrets.
 *
 * Behavior:
 *   - `Error` instances pass through unchanged so console.error can
 *     format the stack natively
 *   - Recursion depth caps at 8 to avoid pathological cycles
 *   - Arrays are scrubbed elementwise
 *   - null / primitives / functions pass through
 */

const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /secret/i,
  /token/i,
  /password/i,
  /signature/i,
  /api[_-]?key/i,
  /authorization/i,
  /^x-.+-sig/i,
  /raw[_-]?body/i,
  /cookie/i,
];

const REDACTED = '[scrubbed]';
const MAX_DEPTH = 8;

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key));
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return value; // let console format natively
  const t = typeof value;
  if (t !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSecretKey(k) ? REDACTED : scrub(v, depth + 1);
  }
  return out;
}

export function safeError(message: string, ctx?: unknown): void {
  if (ctx === undefined) {
    console.error(message);
    return;
  }
  console.error(message, scrub(ctx));
}

// Exposed for tests + future callers that want the same scrubbing
// without the console.error side-effect (e.g. structured loggers).
export const __scrub = scrub;
export const __isSecretKey = isSecretKey;
