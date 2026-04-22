import crypto from 'node:crypto';

/**
 * Shared HMAC verifiers for payment webhooks.
 *
 * - NOWPayments IPN signs the LEXICOGRAPHICALLY-SORTED JSON body with
 *   HMAC-SHA512 and sends the hex digest in the `x-nowpayments-sig`
 *   header. The body MUST be re-serialised with sorted keys before
 *   hashing — verifying against the raw request string will fail.
 *
 * - Lemon Squeezy (Phase 5) signs the raw request body with HMAC-SHA256
 *   and sends the hex digest in `x-signature`. Body is used as-is.
 *
 * Both verifiers use `timingSafeEqual` to prevent timing attacks.
 */

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Recursively sort an arbitrary JSON value alphabetically by key. Arrays
 * preserve their order. This matches NOWPayments' Python reference
 * implementation for IPN signature computation.
 */
function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortJsonKeys(v)]));
  }
  return value;
}

export function verifyNowpaymentsIpn(
  rawBody: string,
  signatureHeader: string | null | undefined,
  ipnSecret: string,
): boolean {
  if (!signatureHeader || !ipnSecret) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const sortedBody = JSON.stringify(sortJsonKeys(parsed));
  const calculated = crypto
    .createHmac('sha512', ipnSecret)
    .update(sortedBody)
    .digest('hex');
  return timingSafeEqualHex(calculated, signatureHeader.trim());
}

export function verifyLemonSqueezyWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  webhookSecret: string,
): boolean {
  if (!signatureHeader || !webhookSecret) return false;
  const calculated = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  return timingSafeEqualHex(calculated, signatureHeader.trim());
}
