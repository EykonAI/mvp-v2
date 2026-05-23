import type { SupabaseClient } from '@supabase/supabase-js';
import posture from '@/lib/fixtures/posture_seed.json';

// Precursor-library cosine matching for the AI evaluator (PR 7).
//
// Reuses the scheme already shipped in /api/intel/precursor/match
// — build a "current state" vector from the relevant theatre's
// posture (30-day composite + 5 domain scores = 35 dims), cosine
// it against precursor_library.vector_json.values (64 dims, seeded
// in supabase/seed/002_precursor_library.sql). cosine() does
// Math.min(a.length, b.length) so the comparison runs on the
// shared 35-dim prefix — same approximation as the existing intel
// endpoint; consistency over precision until embeddings are
// re-generated to a uniform dimensionality.
//
// Theatre is detected by looking for the theatre's slug or label
// inside the outcome statement (case-insensitive). When no theatre
// matches we return an empty list — the AI evaluator simply skips
// the "Historical precursor matches" block in that case rather than
// surfacing meaningless cosine scores.

export interface PrecursorMatch {
  id: string;
  event_type: string;
  label: string;
  window_start: string;
  window_end: string;
  similarity: number;
}

const TOPK_MIN = 1;
const TOPK_MAX = 10;
const TOPK_DEFAULT = 3;

/** Cosine similarity over the shared prefix of two vectors. */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * First theatre whose slug or label appears in the outcome text
 * (case-insensitive). Returns null when nothing matches — caller
 * skips precursor enrichment.
 */
export function detectTheatreFromOutcome(outcome: string): string | null {
  const lower = outcome.toLowerCase();
  for (const t of posture.theatres) {
    const slugMatch = lower.includes(t.slug.toLowerCase());
    const labelMatch = lower.includes(t.label.toLowerCase());
    if (slugMatch || labelMatch) return t.slug;
  }
  return null;
}

/**
 * Compose the current-state vector for a theatre. Same shape as
 * /api/intel/precursor/match: last 30-day composite (30 dims) +
 * the 5 domain scores. Returns null when the theatre is unknown.
 */
export function composeCurrentVector(theatreSlug: string): number[] | null {
  const theatre = posture.theatres.find(t => t.slug === theatreSlug);
  if (!theatre) return null;
  return [
    ...(theatre.last_30d_composite ?? []),
    theatre.air,
    theatre.sea,
    theatre.conflict,
    theatre.grid,
    theatre.imagery,
  ];
}

/**
 * Find the top-K precursor episodes for a free-text outcome. Uses
 * theatre keyword detection to compose a current-state vector, then
 * cosine-similarity-ranks the library. Returns [] when no theatre is
 * detectable in the outcome — the AI evaluator omits the block in
 * that case rather than surfacing low-signal matches.
 */
export async function findPrecursorMatches(
  supabase: SupabaseClient,
  outcomeStatement: string,
  topK: number = TOPK_DEFAULT,
): Promise<PrecursorMatch[]> {
  const theatre = detectTheatreFromOutcome(outcomeStatement);
  if (!theatre) return [];
  const current = composeCurrentVector(theatre);
  if (!current) return [];

  const { data, error } = await supabase
    .from('precursor_library')
    .select('id, event_type, label, window_start, window_end, vector_json');
  if (error || !data || data.length === 0) return [];

  const clampedK = Math.max(TOPK_MIN, Math.min(TOPK_MAX, Math.floor(topK)));
  const scored = data
    .map((row): PrecursorMatch => {
      const r = row as Record<string, unknown>;
      const vj = r.vector_json as { values?: unknown } | null | undefined;
      const v = Array.isArray(vj?.values) ? (vj!.values as number[]) : [];
      return {
        id: String(r.id ?? ''),
        event_type: String(r.event_type ?? ''),
        label: String(r.label ?? ''),
        window_start: String(r.window_start ?? ''),
        window_end: String(r.window_end ?? ''),
        similarity: cosine(current, v),
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, clampedK);

  return scored;
}

/**
 * Render top-K matches as a short block for the AI evaluator's user
 * message. Returns the empty string when no matches were found so the
 * caller can interpolate without an extra branch.
 */
export function formatPrecursorBlockForPrompt(matches: PrecursorMatch[]): string {
  if (matches.length === 0) return '';
  const lines = matches.map(
    m =>
      `  • ${m.label} [${m.event_type}, ${m.window_start} → ${m.window_end}] · cosine ${m.similarity.toFixed(3)}`,
  );
  return [
    'Top historical precursor matches (cosine vs eYKON.ai precursor_library):',
    ...lines,
    'Use these as soft analogs — the outcome should fire only if the live events meaningfully match the historical pattern; high cosine alone is not enough.',
    '',
  ].join('\n');
}
