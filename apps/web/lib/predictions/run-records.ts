/**
 * Run records for the ledger's crons (migration 138).
 *
 * A ROW EXISTS IFF A TICK RAN. A scorer tick that defers every due claim
 * writes no outcome row; an issuer that declines every candidate writes no
 * register row. Both were read as "did not run" on 2026-09-08, and the
 * conclusion drawn from that was wrong. These writers exist so the admin
 * monitor reads functioning from a record of the run itself, never from
 * its side effects.
 *
 * Both are ADDITIVE: a failure to write the record must never fail the tick
 * it describes, so every path here swallows its own error and returns it.
 */
type Writer = { from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> } };

export async function recordScorerRun(
  supabase: Writer,
  row: { candidates: number; scored: number; deferred: number; voided: number; limit: number; selection: string; due_unscored: number | null; ok: boolean; error?: string | null },
): Promise<string | null> {
  try {
    const { error } = await supabase.from('score_predictions_runs').insert({
      candidates: row.candidates, scored: row.scored, deferred: row.deferred, voided: row.voided,
      limit: row.limit, selection: row.selection, due_unscored: row.due_unscored, ok: row.ok, error: row.error ?? null,
    });
    return error ? error.message : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function recordIssuanceRun(
  supabase: Writer,
  row: { source: string; issued: number; already_present: number | null; declined: Record<string, number>; error: string | null },
): Promise<string | null> {
  try {
    const { error } = await supabase.from('issuance_runs').insert({
      source: row.source, issued: row.issued, already_present: row.already_present,
      declined: row.declined ?? {}, error: row.error,
    });
    return error ? error.message : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
