import { formatUsd } from '@/lib/pricing';

type Purchase = {
  id: string;
  payment_provider: 'lemon_squeezy' | 'nowpayments';
  external_order_id: string | null;
  variant_id: string;
  kind: 'subscription_first' | 'subscription_renewal' | 'lifetime' | 'refund';
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'expired';
  amount_cents: number | null;
  currency: string | null;
  pay_currency: string | null;
  crypto_tx_hash: string | null;
  created_at: string;
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Best-effort block-explorer link per chain. NOWPayments carries the chain
// via pay_currency (e.g. 'btc', 'usdctrc20', 'usdcmatic', 'eth'), so we
// fall back to a generic search when the chain is unknown.
function explorerUrl(payCurrency: string | null, txHash: string): string | null {
  if (!payCurrency) return null;
  const c = payCurrency.toLowerCase();
  if (c.startsWith('btc')) return `https://mempool.space/tx/${txHash}`;
  if (c.startsWith('eth') || c === 'usdc' || c === 'usdt') return `https://etherscan.io/tx/${txHash}`;
  if (c.includes('matic') || c.includes('polygon')) return `https://polygonscan.com/tx/${txHash}`;
  if (c.includes('trc')) return `https://tronscan.org/#/transaction/${txHash}`;
  if (c.includes('base')) return `https://basescan.org/tx/${txHash}`;
  if (c.includes('sol')) return `https://solscan.io/tx/${txHash}`;
  return null;
}

export function PurchaseHistory({ purchases }: { purchases: Purchase[] }) {
  if (!purchases || purchases.length === 0) {
    return (
      <section
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--rule)',
          borderRadius: 6,
          padding: '28px 32px',
          marginBottom: 20,
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--ink)',
            marginBottom: 8,
          }}
        >
          Purchase history
        </h3>
        <p style={{ color: 'var(--ink-dim)', fontSize: 13, lineHeight: 1.6 }}>
          You don&apos;t have any payments on record yet. When you upgrade to
          Pro, receipts appear here with the on-chain transaction hash for
          crypto payments.
        </p>
      </section>
    );
  }

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '28px 32px',
        marginBottom: 20,
      }}
    >
      <h3
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--ink)',
          marginBottom: 14,
        }}
      >
        Purchase history
      </h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {purchases.map((p) => {
          const tx = p.crypto_tx_hash;
          const exp = tx ? explorerUrl(p.pay_currency, tx) : null;
          const statusColor =
            p.status === 'completed'
              ? 'var(--green)'
              : p.status === 'pending'
              ? 'var(--amber)'
              : p.status === 'refunded'
              ? 'var(--ink-dim)'
              : 'var(--red)';
          return (
            <li
              key={p.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 12,
                padding: '14px 0',
                borderTop: '1px solid var(--rule-soft)',
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              <div>
                <div style={{ color: 'var(--ink)', marginBottom: 2 }}>
                  {p.variant_id}
                  <span
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10.5,
                      marginLeft: 10,
                      padding: '1px 7px',
                      border: `1px solid ${statusColor}`,
                      color: statusColor,
                      borderRadius: 10,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      verticalAlign: 'middle',
                    }}
                  >
                    {p.status}
                  </span>
                </div>
                <div style={{ color: 'var(--ink-faint)', fontSize: 12 }}>
                  {formatDateTime(p.created_at)}
                  {p.pay_currency && ` · paid in ${p.pay_currency.toUpperCase()}`}
                </div>
                {tx && (
                  <div style={{ marginTop: 4, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
                    {exp ? (
                      <a
                        href={exp}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: 'var(--teal)',
                          textDecoration: 'none',
                          borderBottom: '1px dashed var(--teal-dim, #0E9A88)',
                          wordBreak: 'break-all',
                        }}
                      >
                        {tx.slice(0, 12)}…{tx.slice(-8)} ↗
                      </a>
                    ) : (
                      <span style={{ color: 'var(--ink-dim)', wordBreak: 'break-all' }}>
                        {tx.slice(0, 12)}…{tx.slice(-8)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                <div style={{ fontFamily: 'var(--f-mono)' }}>
                  {p.amount_cents != null ? formatUsd(p.amount_cents) : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                  {p.currency ?? ''}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
