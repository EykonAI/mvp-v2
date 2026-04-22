import type { SupabaseClient } from '@supabase/supabase-js';

export type WebhookProvider = 'lemon_squeezy' | 'nowpayments' | 'resend';

export type IdempotencyResult =
  | { state: 'new'; rowId: string }
  | { state: 'duplicate' };

/**
 * Attempts to record a fresh webhook event in `webhook_events`. On success
 * returns `{ state: 'new', rowId }` — the handler should proceed with
 * business logic and then call markProcessed() or markFailed(). On the
 * unique-violation that indicates a duplicate delivery, returns
 * `{ state: 'duplicate' }` and the handler should return 200 without
 * side-effects.
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
