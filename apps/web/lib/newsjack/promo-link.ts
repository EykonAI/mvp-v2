// Founder decision 7 (18 Sep 2026, Reality Check rev H): every promotional
// asset — one-pagers, shorts, posts, newsjack drafts — links to
// https://eykon.ai/start and nowhere else. No /c/ pages, no public tick URL,
// no globe deep links. The how-it-works depth lives inside the product.
//
// Two halves, both code, because a rule that lives only in a prompt or a
// runbook is a comment:
//   PROMO_LINK      — what the engine now writes into every new draft.
//   promoLinkHold() — the approve/publish path refuses any draft that still
//                     carries another eYKON link. 21 posts went out with a
//                     /c/ link (14 X, 7 Discord) and 973 queued drafts carry
//                     one (measured 2026-09-18); none of those may publish.

/** The one promotional destination. utm parameters may ride on it; the path may not change. */
export const PROMO_LINK = 'https://eykon.ai/start';

// Any eYKON link: with a scheme (https://eykon.ai…, https://mvp.eykon.ai…),
// or bare with a path (eykon.ai/c/…). A bare domain with no path, or an email
// address (hello@eykon.ai), is not a link and is not matched. "eykon.airline"
// is not eykon.ai.
const EYKON_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*eykon\.ai(?![a-z0-9-])((?:[/?#][^\s)"'<>\]]*)?)|(?<![@\w./-])(?:[a-z0-9-]+\.)*eykon\.ai(\/[^\s)"'<>\]]*)/gi;

/** Paths a promotional link may carry: /start, /start?…, /start/<channel>. */
function isStartPath(pathAndQuery: string): boolean {
  // Sentence punctuation after a URL is not part of it ("…/start.").
  const path = (pathAndQuery.split(/[?#]/)[0] ?? '').replace(/[.,;:!]+$/, '');
  return path === '/start' || path.startsWith('/start/');
}

function offendingLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(EYKON_URL_RE)) {
    if (!isStartPath(m[1] ?? m[2] ?? '')) out.push(m[0]);
  }
  return out;
}

/**
 * Why a draft may not be approved or published, or null if it may.
 *
 * Held when its ref_url, or any eYKON link in its posts, points anywhere but
 * /start. A ref_url that is not an eYKON URL at all (a relative /c/… path, a
 * railway host) is held too — the only acceptable ref_url is PROMO_LINK.
 */
export function promoLinkHold(draft: { ref_url: string | null; posts: string[] }): string | null {
  const bad: string[] = [];
  if (draft.ref_url) {
    const ref = draft.ref_url.trim();
    const refOk = /^https?:\/\/(?:www\.)?eykon\.ai(?![a-z0-9.-])/i.test(ref)
      && offendingLinks(ref).length === 0;
    if (!refOk) bad.push(ref);
  }
  for (const p of draft.posts ?? []) bad.push(...offendingLinks(p));
  if (bad.length === 0) return null;
  const unique = Array.from(new Set(bad));
  return (
    `held: promotional links must point to ${PROMO_LINK} only (founder decision 7) — ` +
    `this draft links to ${unique.slice(0, 3).join(', ')}${unique.length > 3 ? ` and ${unique.length - 3} more` : ''}. ` +
    'Reject it; a new draft will carry the /start link.'
  );
}
