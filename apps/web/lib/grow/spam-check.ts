/**
 * Lightweight spam-flag heuristics for inbound advocate submissions.
 * Spec §3.3: "submissions containing common spam indicators are
 * auto-flagged but not auto-rejected — they appear in the founder's
 * queue with a warning banner."
 *
 * Two signals:
 *   1. Known spam-domain links anywhere in the free-text fields.
 *   2. Marketing-spam patterns (hashtag-heavy, "buy now", repeated
 *      capitalisation, etc.).
 *
 * Returns null when clean, or a short string reason when flagged.
 * The reason is persisted to advocate_submissions.spam_reason and
 * shown to the founder in the admin queue.
 */

const SPAM_DOMAINS = [
  // Known spammy/grey-area domains. Maintained inline rather than in
  // a DB table because the list is short and changing it is rare.
  'bit.ly',
  'goo.gl',
  'tinyurl.com',
  'short.io',
  'ow.ly',
  'is.gd',
  'buff.ly',
  't.co/',
  // Known SEO-spam farms (illustrative, not exhaustive). Append more
  // as patterns surface in the founder review queue.
  'crazyseo',
  'rankboost',
  'autoseo',
];

const SPAM_PHRASES = [
  'buy now',
  'click here',
  'limited time offer',
  'guarantee',
  'cheap deals',
  'best price',
  'work from home',
  'make money fast',
  'crypto giveaway',
  'free bitcoin',
  'forex signals',
  'guaranteed roi',
];

const HASHTAG_THRESHOLD = 4; // > N hashtags across all text → flag
const ALLCAPS_RUN_THRESHOLD = 6; // run of N+ uppercase chars (excluding spaces) → flag

export function detectSpam(input: {
  network_description: string;
  why_eykon: string;
  professional_context: string;
  primary_handle: string;
}): string | null {
  const haystack = [
    input.network_description,
    input.why_eykon,
    input.professional_context,
    input.primary_handle,
  ]
    .join(' \n ')
    .toLowerCase();

  for (const dom of SPAM_DOMAINS) {
    if (haystack.includes(dom)) return `spam_domain:${dom}`;
  }
  for (const phrase of SPAM_PHRASES) {
    if (haystack.includes(phrase)) return `spam_phrase:${phrase.slice(0, 30)}`;
  }

  const hashtags = haystack.match(/#[a-z0-9_]+/g) ?? [];
  if (hashtags.length > HASHTAG_THRESHOLD) {
    return `hashtag_density:${hashtags.length}`;
  }

  // Long runs of all-caps in the free-text fields (case-sensitive
  // check; the haystack above lowercased so reuse the original).
  const fullCase = `${input.network_description} ${input.why_eykon} ${input.professional_context}`;
  const capsRun = fullCase.match(/[A-Z]{6,}/g);
  if (capsRun && capsRun.some((s) => s.length >= ALLCAPS_RUN_THRESHOLD)) {
    return `allcaps_run:${capsRun[0].slice(0, 30)}`;
  }

  return null;
}
