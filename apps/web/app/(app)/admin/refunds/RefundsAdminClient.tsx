'use client';
import { useMemo, useState } from 'react';

export type RefundRow = {
  id: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  purchase_id: string;
  purchase_variant_id: string | null;
  purchase_amount_cents: number | null;
  purchase_pay_currency: string | null;
  purchase_created_at: string | null;
  reason: string | null;
  status: 'pending' | 'sent' | 'confirmed' | 'rejected';
  operator_id: string | null;
  operator_note: string | null;
  refund_tx_hash: string | null;
  refund_amount_usd_cents: number | null;
  requested_at: string;
  sent_at: string | null;
  confirmed_at: string | null;
  rejected_at: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatUsd(cents: number | null): string {
  if (cents === null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export function RefundsAdminClient({ refunds }: { refunds: RefundRow[] }) {
  const pending = useMemo(() => refunds.filter(r => r.status === 'pending'), [refunds]);
  const sent = useMemo(() => refunds.filter(r => r.status === 'sent'), [refunds]);
  const closed = useMemo(
    () => refunds.filter(r => r.status === 'confirmed' || r.status === 'rejected'),
    [refunds],
  );

  return (
    <section
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '56px 32px 120px',
        color: 'var(--ink)',
      }}
    >
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            marginBottom: 6,
          }}
        >
          ·· Admin · Refunds ··
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: '-0.5px',
          }}
        >
          Refund reconciliation
        </h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: 13.5, marginTop: 6, maxWidth: 720 }}>
          USDC-only settlement. Send manually from the operational wallet,
          then click "Mark sent" with the tx hash. The user's subscription
          downgrades to Observer at that moment.
        </p>
      </div>

      <Section title="Pending" subtitle={`${pending.length} awaiting send`} accent="var(--amber)">
        {pending.length === 0 ? (
          <Empty>No pending refund requests.</Empty>
        ) : (
          pending.map(r => <PendingRow key={r.id} row={r} />)
        )}
      </Section>

      <Section title="Sent" subtitle={`${sent.length} awaiting on-chain confirm`} accent="var(--teal)">
        {sent.length === 0 ? (
          <Empty>Nothing in flight.</Empty>
        ) : (
          sent.map(r => <ReadOnlyRow key={r.id} row={r} />)
        )}
      </Section>

      <Section title="Closed" subtitle={`${closed.length} confirmed or rejected`} accent="var(--ink-faint)">
        {closed.length === 0 ? (
          <Empty>Nothing closed yet.</Empty>
        ) : (
          closed.map(r => <ReadOnlyRow key={r.id} row={r} />)
        )}
      </Section>
    </section>
  );
}

function Section({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 18,
          fontWeight: 500,
          color: 'var(--ink)',
          marginBottom: 4,
          borderLeft: `2px solid ${accent}`,
          paddingLeft: 10,
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          marginBottom: 12,
          marginLeft: 12,
        }}
      >
        {subtitle}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 16,
        background: 'var(--bg-panel)',
        border: '1px dashed var(--rule-soft)',
        borderRadius: 4,
        color: 'var(--ink-faint)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function ReadOnlyRow({ row }: { row: RefundRow }) {
  return (
    <div
      style={{
        padding: 16,
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule-soft)',
        borderRadius: 6,
      }}
    >
      <RowHeader row={row} />
      <RowMeta row={row} />
      {row.reason && <RowReason text={row.reason} />}
      {row.refund_tx_hash && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-dim)' }}>
          tx hash: <code style={{ fontFamily: 'var(--f-mono)' }}>{row.refund_tx_hash}</code>
        </div>
      )}
      {row.operator_note && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-faint)' }}>
          op note: {row.operator_note}
        </div>
      )}
    </div>
  );
}

function PendingRow({ row }: { row: RefundRow }) {
  const [txHash, setTxHash] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onMarkSent() {
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/refunds/${row.id}/mark-sent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refund_tx_hash: txHash.trim() || null,
          operator_note: note.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr((body?.error as string) ?? 'mark_sent_failed');
        return;
      }
      setSent(true);
    } catch (e) {
      setErr('network_error');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div
        style={{
          padding: 16,
          background: 'var(--bg-panel)',
          border: '1px solid var(--teal)',
          borderRadius: 6,
        }}
      >
        <RowHeader row={row} />
        <p style={{ color: 'var(--teal)', fontSize: 13, marginTop: 8 }}>
          Marked sent. User downgraded to Observer. Refresh to confirm.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 16,
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule-soft)',
        borderRadius: 6,
      }}
    >
      <RowHeader row={row} />
      <RowMeta row={row} />
      {row.reason && <RowReason text={row.reason} />}
      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={txHash}
          onChange={e => setTxHash(e.target.value.slice(0, 200))}
          placeholder="USDC tx hash (0x…)"
          style={{
            flex: '1 1 280px',
            padding: 9,
            fontSize: 13,
            background: 'var(--bg-void)',
            border: '1px solid var(--rule)',
            borderRadius: 4,
            color: 'var(--ink)',
            fontFamily: 'var(--f-mono)',
          }}
        />
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value.slice(0, 500))}
          placeholder="Operator note (optional, min 12 chars for audit)"
          style={{
            flex: '1 1 280px',
            padding: 9,
            fontSize: 13,
            background: 'var(--bg-void)',
            border: '1px solid var(--rule)',
            borderRadius: 4,
            color: 'var(--ink)',
          }}
        />
        <button
          type="button"
          onClick={onMarkSent}
          disabled={submitting}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11.5,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: submitting ? 'var(--rule-strong)' : 'var(--teal)',
            border: 'none',
            borderRadius: 4,
            padding: '10px 16px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {submitting ? 'Sending…' : 'Mark sent →'}
        </button>
      </div>
      {err && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>
          {err}
        </div>
      )}
    </div>
  );
}

function RowHeader({ row }: { row: RefundRow }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 15,
          fontWeight: 500,
          color: 'var(--ink)',
        }}
      >
        {row.user_display_name || row.user_email || row.user_id}
      </span>
      {row.user_email && row.user_display_name && (
        <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
          {row.user_email}
        </span>
      )}
      <span
        style={{
          marginLeft: 'auto',
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
        }}
      >
        {row.purchase_variant_id ?? '—'}
      </span>
    </div>
  );
}

function RowMeta({ row }: { row: RefundRow }) {
  const purchasedAt = row.purchase_created_at ? formatDate(row.purchase_created_at) : '—';
  const requestedAt = formatDate(row.requested_at);
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        rowGap: 6,
        columnGap: 16,
        fontSize: 12,
        marginTop: 8,
      }}
    >
      <Meta label="Purchased" value={purchasedAt} />
      <Meta label="Requested" value={requestedAt} />
      <Meta
        label="Amount"
        value={`${formatUsd(row.purchase_amount_cents)} ${row.purchase_pay_currency ?? ''}`}
      />
      <Meta label="Refund to USDC" value={formatUsd(row.refund_amount_usd_cents)} />
    </dl>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 9.5,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          marginBottom: 2,
        }}
      >
        {label}
      </dt>
      <dd style={{ color: 'var(--ink-dim)', margin: 0 }}>{value}</dd>
    </div>
  );
}

function RowReason({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        background: 'var(--bg-void)',
        border: '1px solid var(--rule-soft)',
        borderLeft: '2px solid var(--ink-faint)',
        fontSize: 12.5,
        color: 'var(--ink-dim)',
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  );
}
