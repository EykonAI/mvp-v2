/**
 * Referral-code capture utilities. The canonical referral code is generated
 * server-side by the handle_new_user Postgres trigger (migration 007). These
 * helpers only deal with reading a referrer's code from the URL or cookie so
 * it can be passed to Supabase signUp via user_metadata.
 */

export const REFERRAL_COOKIE = 'eyk_ref';
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Matches a validly-formatted eyk-<8 alphanumeric> code. The 8-char alphabet
// in migration 007 excludes visually ambiguous characters (0, O, 1, l, I),
// but we accept a broader set here to avoid false negatives on manual entry.
const REFERRAL_CODE_REGEX = /^eyk-[a-z0-9]{6,12}$/i;

export function isValidReferralCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return REFERRAL_CODE_REGEX.test(code.trim());
}

/**
 * Extracts a referral code from a URL search-params object (standard "ref" or
 * "via" keys, matching both Rewardful and common conventions). Returns null
 * when no valid code is present.
 */
export function readReferralFromSearchParams(
  params: URLSearchParams,
): string | null {
  const candidate = params.get('ref') ?? params.get('via') ?? null;
  if (!candidate) return null;
  const trimmed = candidate.trim().toLowerCase();
  return isValidReferralCode(trimmed) ? trimmed : null;
}
