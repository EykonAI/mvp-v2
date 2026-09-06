import type { SupabaseClient } from '@supabase/supabase-js';

export type WebhookProvider = 'lemon_squeezy' | 'nowpayments' | 'resend';

export type IdempotencyResult =
  | { state: 'new'; rowId: string }
  /**
   * The event was seen before and its previous attempt FAILED. The
   * handler should process it again — this is a genuine retry, not a
   * duplicate delivery.
   */
  | { state: 'retry'; rowId: string }
  | { state: 'duplicate' };

/**
 * Attempts to record a fresh webhook event in `webhook_events`. On success
 * returns `{ state: 'new', rowId }` — the handler should proceed with
 * business logic and then call markProcessed() or markFailed(). On the
 * On a unique-violation the prior attempt is inspected: if it FAILED,
 * returns `{ state: 'retry', rowId }` and the handler should process it
 * again; otherwise returns `{ state: 'duplicate' }` and the handler
 * should return 200 without side-effects.
 *
 * Uses the service-role client because RLS blocks inserts into
 * webhook_events from anon/auth contexts — webhooks run without a user
 * session.
 */
export async function recordWebhookReceipt(
  supabaseServiceRole: SupabaseClient,
  provider: WebhookProvider,
  eventId: string,
  eventType: string | null,
  payload: unknown,
): Promise<IdempotencyResult> {
  const { data, error } = await supabaseServiceRole
    .from('webhook_events')
    .insert({
      provider,
      event_id: eventId,
      event_type: eventType,
      payload,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    // Postgres error 23505 = unique_violation. Supabase surfaces it in
    // error.code. Any other error is a real problem — bubble up.
    if (error.code === '23505') {
      // A collision does NOT automatically mean "already handled". If
      // the previous attempt FAILED, this delivery is the provider
      // retrying something we never completed, and short-circuiting it
      // strands the event forever.
      //
      // That is not hypothetical: on 2026-09-06 a real $9 payment's
      // 'finished' event failed on a downstream defect, and because the
      // row then existed, every subsequent resend would have returned
      // 200 'duplicate' without ever retrying. A permanent dead end
      // reached by a transient failure — on the payment path.
      const { data: existing, error: lookupErr } = await supabaseServiceRole
        .from('webhook_events')
        .select('id, status')
        .eq('provider', provider)
        .eq('event_id', eventId)
        .maybeSingle();

      // Fail loud rather than guessing. If we cannot read the prior
      // attempt we do not know whether it succeeded, and silently
      // assuming 'duplicate' is the assumption that loses money.
      if (lookupErr) {
        throw new Error(`webhook_events conflict lookup failed: ${lookupErr.message}`);
      }
      if (!existing) {
        // Raced with a concurrent delete, or the conflict came from a
        // different constraint than we assume. Treat as duplicate — the
        // safe direction — but say so.
        console.warn(`[idempotency] 23505 on ${provider}/${eventId} but no row found`);
        return { state: 'duplicate' };
      }

      if (existing.status === 'failed') {
        // Re-arm the row so a second failure is recorded against this
        // same attempt rather than leaving a stale 'failed'.
        await supabaseServiceRole
          .from('webhook_events')
          .update({ status: 'pending', error_message: null })
          .eq('id', existing.id);
        return { state: 'retry', rowId: existing.id as string };
      }

      return { state: 'duplicate' };
    }
    throw new Error(`webhook_events insert failed: ${error.message}`);
  }

  return { state: 'new', rowId: data.id };
}

export async function markWebhookProcessed(
  supabaseServiceRole: SupabaseClient,
  rowId: string,
): Promise<void> {
  const { error } = await supabaseServiceRole
    .from('webhook_events')
    .update({ status: 'processed', processed_at: new Date().toISOString() })
    .eq('id', rowId);
  if (error) {
    console.error('markWebhookProcessed failed', rowId, error.message);
  }
}

export async function markWebhookFailed(
  supabaseServiceRole: SupabaseClient,
  rowId: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabaseServiceRole
    .from('webhook_events')
    .update({
      status: 'failed',
      processed_at: new Date().toISOString(),
      error_message: errorMessage.slice(0, 500),
    })
    .eq('id', rowId);
  if (error) {
    console.error('markWebhookFailed failed', rowId, error.message);
  }
}
