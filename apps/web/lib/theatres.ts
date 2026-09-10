/**
 * The theatres eYKON actually computes posture for.
 *
 * This exists because a tool argument that is never validated is a way to
 * invent data. /api/intel/precursor/match takes a theatre_slug, and when it
 * could not resolve one it fell through to a SYNTHETIC 35-dimension sine
 * wave — so a caller asking about a theatre that does not exist received
 * cosine similarities against a sine wave, scored to sixteen decimal
 * places, with their fabricated slug echoed back as though it were real.
 *
 * Verified against production on 2026-09-10: these six and only these six
 * carry posture_scores rows, each with 31 distinct days in the trailing
 * 30-day window — comfortably past the 10-day floor buildLiveCurrent
 * needs, so every valid theatre resolves LIVE and none of them relies on
 * the fixture path.
 *
 * Keep in step with lib/fixtures/posture_seed.json, which carries the same
 * six, and with the posture writer.
 */
export const THEATRE_SLUGS = [
  'black-sea',
  'gulf-of-guinea',
  'hormuz',
  'malacca',
  'red-sea',
  'taiwan-strait',
] as const;

export type TheatreSlug = (typeof THEATRE_SLUGS)[number];

export function isTheatreSlug(v: unknown): v is TheatreSlug {
  return typeof v === 'string' && (THEATRE_SLUGS as readonly string[]).includes(v);
}

/**
 * Display labels, as the posture fixture spells them. A caller — human or
 * model — writes "Strait of Hormuz" far more naturally than "hormuz", and
 * refusing that spelling would trade one dishonesty (inventing an answer)
 * for a different unhelpfulness (refusing a real place because of its
 * name). Resolve the label; refuse only what resolves to nothing.
 */
const THEATRE_LABELS: Record<TheatreSlug, string> = {
  'black-sea': 'Black Sea',
  'gulf-of-guinea': 'Gulf of Guinea',
  hormuz: 'Strait of Hormuz',
  malacca: 'Strait of Malacca',
  'red-sea': 'Red Sea',
  'taiwan-strait': 'Taiwan Strait',
};

const canon = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Resolve a slug, a display label, or a near spelling of either. Null if it is not a theatre we compute. */
export function resolveTheatreSlug(v: unknown): TheatreSlug | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const c = canon(v);
  for (const slug of THEATRE_SLUGS) {
    if (canon(slug) === c || canon(THEATRE_LABELS[slug]) === c) return slug;
  }
  return null;
}
