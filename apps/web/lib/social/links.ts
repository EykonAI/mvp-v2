// ─── SOCIAL SHORT LINKS ──────────────────────────────────────────
//
// eykon.ai/discord and eykon.ai/x are the links that go in bios, in
// posts, and anywhere a link outlives the page it was printed on.
//
// They exist INSTEAD of a Discord vanity URL, which needs Server Boost
// Level 3 (14 boosts, roughly $70/month) and — the part that actually
// decides it — is RENTED: let the boosts lapse and the vanity name is
// released, breaking every link already published.
//
// Owning the redirect buys three things a vanity URL cannot:
//
//   1 · RE-POINTABLE. A Discord invite can be revoked or regenerated.
//       When that happens we change one env var and every published
//       link keeps working. This is why the destination is an env var
//       and not a constant.
//   2 · MEASURABLE. A raw discord.gg click is invisible to us; a click
//       through this route is a server-side event. "How many people
//       clicked through to our social" becomes a number.
//   3 · OURS. eykon.ai/discord reads as the product. discord.gg/xxxxxx
//       reads as somebody's Discord server.

export type SocialSlug = 'discord' | 'x';

export interface SocialLink {
  slug: SocialSlug;
  /** Env var that re-points the link without a deploy. */
  envVar: string;
  /** Checked-in fallback: correct on the day it shipped, and a safe
   *  landing if the env var is ever unset. Never a dead end, never a
   *  500 — an unset var degrades to the last known-good destination. */
  fallback: string;
}

export const SOCIAL_LINKS: Record<SocialSlug, SocialLink> = {
  discord: {
    slug: 'discord',
    envVar: 'SOCIAL_DISCORD_URL',
    // The permanent, unlimited-use marketing invite landing in
    // #bienvenue-et-règles. Set SOCIAL_DISCORD_URL to rotate it.
    fallback: 'https://discord.gg/YmAKTdcZrX',
  },
  x: {
    slug: 'x',
    envVar: 'SOCIAL_X_URL',
    // @eykon_ai — with the underscore. The handle was written three
    // different ways across the Drive documents before the account
    // itself settled it; this is the one the account actually uses.
    fallback: 'https://x.com/eykon_ai',
  },
};

export interface ResolvedSocialUrl {
  url: string;
  source: 'env' | 'fallback';
}

export function resolveSocialUrl(slug: SocialSlug): ResolvedSocialUrl {
  const link = SOCIAL_LINKS[slug];
  const fromEnv = process.env[link.envVar]?.trim();
  if (fromEnv) return { url: fromEnv, source: 'env' };
  return { url: link.fallback, source: 'fallback' };
}
