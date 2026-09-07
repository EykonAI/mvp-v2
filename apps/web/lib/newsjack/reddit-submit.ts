import { approvedSubreddits } from '@/lib/copy/channels/reddit/codex';

/**
 * Prefilled Reddit compose links for an approved draft.
 *
 * WHY THIS AND NOT AN API PUBLISH PATH.
 *
 * Reddit stays draft-only, and the reasons got stronger rather than weaker:
 *
 *   1. The posting account cannot reach r/OSINT until it clears the community's
 *      age-and-karma gate. An API publish path built today is a path that
 *      cannot be used for months — the same trap already recorded for TikTok,
 *      where "a publishing path built before the audit would look exactly like
 *      a working one and reach zero people".
 *   2. Automated marketing posting is COMMERCIAL use of the Reddit API and
 *      needs approval plus a paid agreement.
 *   3. The failure mode is invisible. A shadowbanned post reads as published in
 *      our queue, renders correctly in our own logged-in view, and reaches
 *      nobody — the platform master pattern on the one channel where it is
 *      hardest to detect.
 *
 * A prefilled compose URL sidesteps all three. It touches no API, so there is
 * no terms question; the founder posts as themselves through Reddit's own UI,
 * so there is no bot to shadowban; and a human stays at the publish gate, which
 * the SOP requires anyway. It also works TODAY in any community the account can
 * post to, which is the whole karma-building window.
 *
 * ONE LINK PER APPROVED COMMUNITY, and no guessing. The artifact validates its
 * subreddit against the allowlist at assembly and then discards it, so a draft
 * does not carry its own destination. Rather than infer one, this emits a link
 * per approved entry: with a single approved community that is one button, and
 * if the allowlist grows the founder picks. Inferring would be a stored
 * assumption that silently goes wrong the day a second community is approved.
 */

/** Conservative ceiling for the whole URL. Reddit drafts average ~2,050
 *  characters of body and encode to roughly 1.5-2x that, so a full prefill
 *  lands near 4,000 — comfortably under, but the guard exists because the
 *  common proxy header limit is 8k and a silently truncated post is worse
 *  than an honest paste. */
const MAX_URL_CHARS = 8000;

export interface RedditSubmitTarget {
  slug: string;
  /** Compose URL. In 'title-only' mode the body is deliberately NOT in it. */
  url: string;
  /** 'full' prefills title and body; 'title-only' means the body must be pasted. */
  mode: 'full' | 'title-only';
  /** Flair the community expects. Reddit's prefill cannot set flair without an
   *  internal id we do not have, so this is surfaced for the human instead of
   *  pretended away. */
  flairRequired: string | null;
  urlChars: number;
}

function composeUrl(slug: string, title: string, text?: string): string {
  const qs = new URLSearchParams({ title });
  if (text !== undefined) qs.set('text', text);
  return `https://www.reddit.com/r/${encodeURIComponent(slug)}/submit?${qs.toString()}`;
}

/**
 * `posts` for a Reddit artifact is [title, selfText] (see the channel writer).
 * Anything else is not a Reddit draft and yields no targets.
 */
export function redditSubmitTargets(posts: string[] | null | undefined): RedditSubmitTarget[] {
  const title = (posts?.[0] ?? '').trim();
  const body = (posts?.[1] ?? '').trim();
  if (!title) return [];

  return approvedSubreddits().map((entry) => {
    const full = composeUrl(entry.slug, title, body);
    if (full.length <= MAX_URL_CHARS) {
      return {
        slug: entry.slug, url: full, mode: 'full' as const,
        flairRequired: entry.flairRequired, urlChars: full.length,
      };
    }
    // Too long to carry safely. Prefill the title only and let the UI put the
    // body on the clipboard — never a truncated body, which would publish a
    // post missing its limits paragraph or its disclosure.
    const titleOnly = composeUrl(entry.slug, title);
    return {
      slug: entry.slug, url: titleOnly, mode: 'title-only' as const,
      flairRequired: entry.flairRequired, urlChars: titleOnly.length,
    };
  });
}
