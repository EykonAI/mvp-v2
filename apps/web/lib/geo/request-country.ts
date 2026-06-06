/**
 * Resolve an ISO-3166 alpha-2 country code from a request's edge geo
 * headers — best-effort, zero-dependency, no external lookup.
 *
 * Most edges inject a country header: Vercel (`x-vercel-ip-country`),
 * Cloudflare (`cf-ipcountry`), and several CDNs (`x-geo-country`,
 * `x-country-code`). We read whichever is present, in priority order.
 *
 * If the platform in front of the app injects NONE of these, this returns
 * null and the caller stores NULL (rendered as "—"). We deliberately do
 * NOT call an external IP→country API: that would add latency + a runtime
 * dependency to the signup hot path, and we never want to handle the raw
 * IP beyond the existing one-way ip_hash.
 *
 * Sentinel values that mean "unknown" (Cloudflare's `XX`, Tor exit `T1`)
 * are treated as null.
 */
const GEO_HEADERS = [
  'x-vercel-ip-country',
  'cf-ipcountry',
  'x-geo-country',
  'x-country-code',
] as const;

const UNKNOWN = new Set(['XX', 'T1']);

export function resolveRequestCountry(headers: Headers): string | null {
  for (const name of GEO_HEADERS) {
    const value = headers.get(name)?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value) && !UNKNOWN.has(value)) {
      return value;
    }
  }
  return null;
}
