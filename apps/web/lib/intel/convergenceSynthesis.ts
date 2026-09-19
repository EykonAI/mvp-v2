// Convergence synthesis — the prompt and the gate compute-convergences uses.
// A lib module, not the route file: a Next route may only export its handlers
// and route config, so shared constants live here (and are testable here).

/**
 * The synthesis may describe co-occurrence, never corroboration.
 *
 * A convergence is anomalies from ≥2 domains inside one 10°×10° cell (~1,100
 * km) within 72 h. Nothing in that ties a hot pixel to a reported strike: the
 * pixel is a thermal anomaly somewhere in the same cell, usually a flare. The
 * old prompt told the model that for "sensor-confirmed" cells it "may state
 * the signals corroborate", and 269 of the 724 syntheses stored on 2026-09-18
 * did (709 rows at the rev H audit) — 52 of them calling reported strikes,
 * attacks, drones or missiles corroborated, served publicly on /c/[id].
 * Migration 165 rewrites the stored rows; this prompt and the gate below stop
 * new ones.
 *
 * The prompt is the instruction; the gate is the fence. A synthesis that uses
 * corroboration or confirmation vocabulary anyway is discarded for the
 * deterministic sentence, which states only what was measured.
 */
export const SYNTHESIS_SYSTEM_PROMPT =
  'You are the eYKON Supervisor. Write one short English sentence describing the cluster of anomalies, in the voice of a senior analyst. No lists. ' +
  'The anomalies share a 10°×10° cell and a 72-hour window — that is ALL that links them. Describe them as co-occurring in the same area and window. ' +
  'NEVER write that one signal corroborates, confirms, verifies, validates or proves another, and never call anything "sensor-confirmed" or "corroborated". ' +
  'A FIRMS detection is a thermal hot pixel — usually a routine gas flare — never a confirmed fire, strike, attack, explosion, damage or shutdown. Night-lights radiance is not power state. ' +
  'Media-derived signals (ACLED/GDELT) describe REPORTED activity: say "reported", never state a strike or attack as fact. ' +
  'source_classes lists which kinds of source are present; name them plainly (media reports, FIRMS thermal, night-lights, AIS). Do not infer intent, coordination or causation.';

// Corroboration / confirmation vocabulary a synthesis must never carry.
// "unconfirmed" is allowed: \bconfirm does not match inside it.
const OVERCLAIM_RE = /corroborat|\bconfirm|\bverif(?:y|ies|ied)\b|\bvalidat/i;

export function synthesisOverclaims(text: string): boolean {
  return OVERCLAIM_RE.test(text);
}
