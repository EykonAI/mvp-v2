/**
 * Component A — silent attribution mechanic. Pure utilities (no DB,
 * no cookies, no Next request/response). Validators, parsers, the
 * URL-injection helper used by Share buttons in PRs 4–5.
 *
 * Cookie + DB pieces live in cookie.ts and capture.ts respectively.
 */

// public_id format: 'u_' + 10 hex chars (40 bits of entropy). Spec §1.2
// specifies an 8-12 char base32 random string; Postgres' built-in encode()
// does not support base32 so migration 025 uses hex, which yields the
// same enumeration-resistance + URL-safety property within the spec window.
export const PUBLIC_ID_REGEX = /^u_[a-f0-9]{10}$/;

// Cookie persists 90 days (spec §1.3 step 2). First-touch wins — the
// middleware never overwrites an existing cookie.
export const EYKON_REF_COOKIE = 'eykon_ref';
export const EYKON_REF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

// Artifact taxonomy from spec §1.1. Strings are stable identifiers used
// in attribution_events.artifact_type. The user-facing label lives in
// the share button's UI; this list is the canonical write-side enum.
export const ARTIFACT_TYPES = [
  'A1', // replayable view URL (cases, replays)
  'A2', // AI Analyst conversation link
  'A3', // Calibration Ledger snapshot
  'A4', // Notification public view
  'A5', // Shadow Fleet ranking link
  'A6', // Regime Shifts detector output
  'A7', // Posture score view
  'A8', // generic share-this-view button
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export function isValidPublicId(value: string | null | undefined): boolean {
  if (!value) return false;
  return PUBLIC_ID_REGEX.test(value);
}

export function isValidArtifactType(value: string | null | undefined): value is ArtifactType {
  if (!value) return false;
  return (ARTIFACT_TYPES as readonly string[]).includes(value);
}

/**
 * Reads the public_id from a URL's search params. Returns null when no
 * valid value is present. Coexists with the legacy ?ref=eyk-… Rewardful
 * format (lib/auth/referral.ts) — that path validates the eyk- prefix
 * separately, so the two readers are mutually exclusive on a given URL.
 */
export function parseEykonRefFromSearchParams(
  params: URLSearchParams,
): string | null {
  const candidate = params.get('ref');
  if (!candidate) return null;
  return isValidPublicId(candidate) ? candidate : null;
}

/**
 * Appends ?ref=u_<public_id> to a URL, preserving any existing query
 * string. Used by Share buttons in PRs 4–5 to inject the sharer's
 * public_id into outbound artifact URLs.
 *
 * Returns the original URL unchanged when publicId is null or invalid —
 * Share buttons can call this unconditionally without guarding for the
 * unauthenticated / no-public-id case.
 */
export function withAttribution(url: string, publicId: string | null | undefined): string {
  if (!isValidPublicId(publicId)) return url;
  // Try absolute first (URL parse); fall back to a relative-safe append.
  try {
    const u = new URL(url);
    u.searchParams.set('ref', publicId as string);
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}ref=${publicId}`;
  }
}
