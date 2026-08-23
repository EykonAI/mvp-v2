/**
 * Path-based channel tagging for the closing page.
 *
 * WHY THIS EXISTS — measured, not assumed
 * ---------------------------------------
 * Privacy browsers strip `utm_*` from the URL BEFORE any of our code runs.
 * Verified on production 2026-08-23: typing
 *   https://eykon.ai/start?utm_source=ddg_test
 * straight into DuckDuckGo's address bar loads `https://eykon.ai/start` —
 * the parameter is gone from the address bar itself. DuckDuckGo's Link
 * Tracking Protection does this by design; Brave and Safari 17+ ship
 * comparable features.
 *
 * The whole attribution chain then inherits the blank: no utm on the
 * pageview event, no first_utm_source person property, no first-touch
 * record, and finally a NULL `purchases.utm_source` — the one column the
 * admin Subscribers view exists to report on.
 *
 * That undercount is not random noise. eYKON's audience — OSINT, risk,
 * geopolitics — self-selects for people who care about tracking, so the
 * loss is concentrated in exactly the visitors we most want, and it makes
 * the best channels look like the worst.
 *
 * THE FIX: put the channel in the PATH. A tracking-parameter stripper
 * identifies query parameters as tracking; a path segment is
 * indistinguishable from ordinary routing and is never removed.
 *
 *   /start/reddit     survives      /start?utm_source=reddit    does not
 *
 * The query string still wins when it survives, because it carries
 * campaign and content that a single path segment cannot. The path is the
 * floor, not the ceiling.
 */

/** Slugs we publish. The medium is only asserted where we actually know it. */
const KNOWN_CHANNELS: Record<string, { source: string; medium: string | null }> = {
  reddit: { source: 'reddit', medium: 'social' },
  discord: { source: 'discord', medium: 'social' },
  x: { source: 'x', medium: 'social' },
  twitter: { source: 'x', medium: 'social' },
  linkedin: { source: 'linkedin', medium: 'social' },
  telegram: { source: 'telegram', medium: 'social' },
  substack: { source: 'substack', medium: 'email' },
  youtube: { source: 'youtube', medium: 'social' },
  newsjack: { source: 'newsjack', medium: 'referral' },
  proactive: { source: 'proactive', medium: 'referral' },
  fp: { source: 'founding_partner', medium: 'referral' },
};

// Deliberately strict: lowercase, starts alphanumeric, dashes/underscores
// inside, 32 chars max. Anything else is treated as "no channel" rather
// than recorded, so a crawler walking /start/<junk> cannot invent traffic
// sources in the reporting.
const SLUG = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type ChannelTag = { source: string; medium: string | null };

/**
 * Resolve a path segment to a channel tag, or null if it is not a slug we
 * are willing to record. Unknown-but-well-formed slugs ARE accepted so a
 * new campaign can go live without a deploy — the strict pattern is what
 * keeps the data clean, not a closed list.
 */
export function channelFromSlug(raw: string | null | undefined): ChannelTag | null {
  if (!raw) return null;
  const slug = raw.trim().toLowerCase();
  if (!SLUG.test(slug)) return null;
  return KNOWN_CHANNELS[slug] ?? { source: slug, medium: null };
}
