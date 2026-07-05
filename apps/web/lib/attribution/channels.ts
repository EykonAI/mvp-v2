/**
 * PAMS — per-channel marketing attribution. Pure utilities (no DB, no
 * cookies, no Next request/response): the canonical channel list, the
 * cookie name/window, the UTM/?ch parser+validator, and a link-builder
 * helper for marketing.
 *
 * This is the SINGLE SOURCE OF TRUTH for channel tags — both the
 * middleware validator and any link builder reference CHANNELS so
 * marketing and code never drift. Sibling of lib/referral/attribution.ts
 * (which owns ?ref= referral capture); the two mechanisms are kept
 * deliberately separate (see migration 046).
 */

// ─── Canonical channel taxonomy (PAMS brief §8) ────────────────
// utm_source values, lower-case. The single source of truth; a tag not
// in this list is ignored (no cookie, no touch) so the reporting tables
// stay clean. 'direct' / 'organic' are the untagged fallbacks.
export const CHANNELS = [
  'x', // Twitter / X posts                (utm_medium=social)
  'linkedin', // LinkedIn posts & DMs       (social)
  'newsletter', // owned newsletter         (email)
  'producthunt', // Product Hunt launch     (referral)
  'reddit', // subreddit posts              (community)
  'hackernews', // HN / Show HN             (community)
  'youtube', // video                       (social)
  'discord', // community                   (community)
  'telegram', // community                  (social)
  'repcard', // embeddable Creator Pro reputation card (utm_content=<handle>)
  'space_embed', // in-Space artifact-card CTA (monetisation §4.2)
  'direct', // fallback: no tag
  'organic', // fallback: untagged organic
] as const;

export type Channel = (typeof CHANNELS)[number];

const CHANNEL_SET: ReadonlySet<string> = new Set(CHANNELS);

// Forgiving aliases → canonical tag. Lets a slightly-off hand-typed tag
// still resolve instead of being silently dropped. Keep minimal; add a
// canonical entry above rather than an alias when a real new channel
// appears.
const CHANNEL_ALIASES: Readonly<Record<string, Channel>> = {
  twitter: 'x',
  hn: 'hackernews',
  'hacker-news': 'hackernews',
  ph: 'producthunt',
  product_hunt: 'producthunt',
  'product-hunt': 'producthunt',
  yt: 'youtube',
};

// Cookie persists 90 days — matches the referral cookie
// (EYKON_REF_COOKIE_MAX_AGE_SECONDS) per decision D5 so both
// attribution windows stay aligned. First-touch wins: the middleware
// never overwrites an existing cookie.
export const EYKON_CHANNEL_COOKIE = 'eykon_channel';
export const EYKON_CHANNEL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

// The canonical campaign-tag query params. utm_source is the industry
// standard and primary; ?ch= is a short hand-shareable alias. ?ref= is
// intentionally NOT here — it is owned by the referral system.
export const UTM_SOURCE_PARAM = 'utm_source';
export const CHANNEL_ALIAS_PARAM = 'ch';

export type ChannelUtm = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
};

export type ChannelTouch = {
  channel: Channel;
  utm: ChannelUtm;
};

/**
 * Normalises a raw tag (case/whitespace/alias) to a canonical Channel,
 * or null if it is unknown. Length-capped at 32 to match the SQL guard
 * in handle_new_user (migration 047).
 */
export function normalizeChannel(value: string | null | undefined): Channel | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v || v.length > 32) return null;
  if (CHANNEL_SET.has(v)) return v as Channel;
  return CHANNEL_ALIASES[v] ?? null;
}

export function isValidChannel(value: string | null | undefined): value is Channel {
  return normalizeChannel(value) !== null;
}

/**
 * Resolves the canonical channel from a URL's search params. utm_source
 * wins; ?ch= is the fallback alias. Returns null when neither carries a
 * known channel. Used by the middleware to decide the first-touch cookie
 * value — mirrors parseEykonRefFromSearchParams in the referral lib.
 */
export function parseChannelFromSearchParams(params: URLSearchParams): Channel | null {
  return (
    normalizeChannel(params.get(UTM_SOURCE_PARAM)) ??
    normalizeChannel(params.get(CHANNEL_ALIAS_PARAM))
  );
}

/**
 * Like parseChannelFromSearchParams but also returns the raw UTM set for
 * granular per-campaign reporting. Used by the silent capture route to
 * build the channel_touchpoints row. Returns null when there is no valid
 * channel — callers should not write a touch without one.
 */
export function parseChannelTouch(params: URLSearchParams): ChannelTouch | null {
  const channel = parseChannelFromSearchParams(params);
  if (!channel) return null;
  return {
    channel,
    utm: {
      source: params.get(UTM_SOURCE_PARAM),
      medium: params.get('utm_medium'),
      campaign: params.get('utm_campaign'),
      content: params.get('utm_content'),
      term: params.get('utm_term'),
    },
  };
}

/**
 * Appends a canonical channel tag to a URL for marketing link-building.
 * Writes utm_source (+ utm_campaign / utm_medium when supplied),
 * preserving any existing query string. Returns the URL unchanged when
 * the channel is not canonical, so callers need not pre-validate.
 */
export function withChannel(
  url: string,
  channel: string | null | undefined,
  opts?: { campaign?: string; medium?: string },
): string {
  const canonical = normalizeChannel(channel);
  if (!canonical) return url;
  const apply = (set: (k: string, v: string) => void) => {
    set(UTM_SOURCE_PARAM, canonical);
    if (opts?.medium) set('utm_medium', opts.medium);
    if (opts?.campaign) set('utm_campaign', opts.campaign);
  };
  try {
    const u = new URL(url);
    apply((k, v) => u.searchParams.set(k, v));
    return u.toString();
  } catch {
    const parts: string[] = [`${UTM_SOURCE_PARAM}=${encodeURIComponent(canonical)}`];
    if (opts?.medium) parts.push(`utm_medium=${encodeURIComponent(opts.medium)}`);
    if (opts?.campaign) parts.push(`utm_campaign=${encodeURIComponent(opts.campaign)}`);
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${parts.join('&')}`;
  }
}
