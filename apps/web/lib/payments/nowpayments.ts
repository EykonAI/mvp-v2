// Typed NOWPayments client (v1 REST API).
// Docs: https://documenter.getpostman.com/view/7907941/S1a32n38

const DEFAULT_BASE_URL = 'https://api.nowpayments.io/v1';

type CreateInvoiceInput = {
  price_amount: number;            // major-unit (e.g. 190 for €190, NOT cents)
  price_currency: string;          // 'eur', 'usd', 'usdc', ...
  order_id: string;                // our purchase UUID
  order_description: string;
  ipn_callback_url: string;
  success_url: string;
  cancel_url: string;
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
};

export type NowpaymentsInvoice = {
  id: string;
  token_id: string;
  order_id: string;
  order_description: string;
  price_amount: string;
  price_currency: string;
  pay_currency: string | null;
  ipn_callback_url: string;
  invoice_url: string;
  success_url: string;
  cancel_url: string;
  created_at: string;
  updated_at: string;
};

export type NowpaymentsIpnPayload = {
  payment_id: number;
  payment_status:
    | 'waiting'
    | 'confirming'
    | 'confirmed'
    | 'sending'
    | 'partially_paid'
    | 'finished'
    | 'failed'
    | 'refunded'
    | 'expired';
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  actually_paid: number;
  pay_currency: string;
  order_id: string;
  order_description: string;
  purchase_id: string;
  outcome_amount: number;
  outcome_currency: string;
  // NOWPayments sometimes includes a tx hash on finished payments; the
  // field name varies by coin/network, but when present it lives here.
  payin_hash?: string;
  payout_hash?: string;
};

export function getNowpaymentsBaseUrl(): string {
  return process.env.NOWPAYMENTS_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

export function getNowpaymentsApiKey(): string {
  const key = process.env.NOWPAYMENTS_API_KEY;
  if (!key) {
    throw new Error('NOWPAYMENTS_API_KEY is not set');
  }
  return key;
}

export async function createNowpaymentsInvoice(
  input: CreateInvoiceInput,
): Promise<NowpaymentsInvoice> {
  const res = await fetch(`${getNowpaymentsBaseUrl()}/invoice`, {
    method: 'POST',
    headers: {
      'x-api-key': getNowpaymentsApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      is_fixed_rate: true,
      is_fee_paid_by_user: true,
      ...input,
    }),
    // NOWPayments recommends a 10 s timeout; Node 18+ supports AbortSignal.timeout.
    signal: AbortSignal.timeout(10_000),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `NOWPayments /invoice ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  try {
    return JSON.parse(text) as NowpaymentsInvoice;
  } catch {
    throw new Error(
      `NOWPayments /invoice returned non-JSON response: ${text.slice(0, 200)}`,
    );
  }
}

export function extractCryptoTxHash(ipn: NowpaymentsIpnPayload): string | null {
  return ipn.payin_hash || ipn.payout_hash || null;
}
