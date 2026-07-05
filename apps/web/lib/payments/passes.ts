import type { SupabaseClient } from '@supabase/supabase-js';
import { getPassProduct } from '@/lib/pricing';

// Completion handler for one-off passes & packs (monetisation review
// §4.4, mig 075). Called by the NOWPayments webhook INSTEAD of the
// complete_crypto_purchase RPC when purchases.kind is 'week_pass' or
// 'query_pack'.
//
// Retry-idempotent by construction: the grant is written FIRST with a
// UNIQUE(purchase_id) upsert-ignore, THEN the purchase is marked
// completed. A crash between the two leaves the purchase 'pending';
// the IPN retry re-runs, the grant insert no-ops on the unique index,
// and the purchase gets marked. A double-grant is impossible; a lost
// grant is impossible.

export type PassPurchaseRow = {
  id: string;
  user_id: string;
  variant_id: string;
  kind: string;
  status: string;
};

export async function completePassPurchase(
  admin: SupabaseClient,
  purchase: PassPurchaseRow,
  ipn: {
    externalOrderId: string;
    payCurrency: string;
    txHash: string | null;
    amountUsdCents: number;
  },
): Promise<{ ok: boolean; replay: boolean; error?: string }> {
  if (purchase.status === 'completed') return { ok: true, replay: true };

  const product = getPassProduct(purchase.variant_id);
  if (!product) {
    return { ok: false, replay: false, error: `Unknown pass product: ${purchase.variant_id}` };
  }

  // 1 — the grant, first.
  if (product.grants.type === 'tier_override') {
    const expires = new Date(Date.now() + product.grants.days * 86_400_000).toISOString();
    const { error } = await admin
      .from('tier_overrides')
      .upsert(
        {
          user_id: purchase.user_id,
          tier: product.grants.tier,
          source: 'week_pass',
          expires_at: expires,
          purchase_id: purchase.id,
        },
        { onConflict: 'purchase_id', ignoreDuplicates: true },
      );
    if (error) return { ok: false, replay: false, error: `override insert: ${error.message}` };
  } else {
    const month = new Date();
    const monthStart = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const { error } = await admin
      .from('usage_bonuses')
      .upsert(
        {
          user_id: purchase.user_id,
          counter: product.grants.counter,
          bonus: product.grants.bonus,
          month: monthStart,
          purchase_id: purchase.id,
        },
        { onConflict: 'purchase_id', ignoreDuplicates: true },
      );
    if (error) return { ok: false, replay: false, error: `bonus insert: ${error.message}` };
  }

  // 2 — mark the purchase completed.
  const { error: updErr } = await admin
    .from('purchases')
    .update({
      status: 'completed',
      external_order_id: ipn.externalOrderId,
      pay_currency: ipn.payCurrency,
      crypto_tx_hash: ipn.txHash,
      amount_cents: ipn.amountUsdCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', purchase.id);
  if (updErr) return { ok: false, replay: false, error: `purchase update: ${updErr.message}` };

  // 3 — receipt email via the existing notification queue.
  await admin.from('notification_queue').insert({
    user_id: purchase.user_id,
    channel: 'email',
    title:
      product.kind === 'week_pass'
        ? 'Your eYKON Week Pass is active'
        : 'Your eYKON query pack is loaded',
    body:
      product.kind === 'week_pass'
        ? 'Full Pro access for 7 days — live feeds, all INTEL workspaces, the full analyst. It expires on its own; nothing to cancel.'
        : '+25 AI Analyst queries added for this calendar month.',
    payload: {
      template: 'receipt_crypto',
      variant_id: purchase.variant_id,
      kind: product.kind,
      pay_currency: ipn.payCurrency,
      tx_hash: ipn.txHash,
    },
  });

  return { ok: true, replay: false };
}
