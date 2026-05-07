'use client';

import { useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';

export type ReferralRow = {
  id: string;
  advocate_user_id: string;
  advocate_email: string | null;
  advocate_display_name: string | null;
  referred_user_id: string;
  referred_email: string | null;
  referred_display_name: string | null;
  status: string;
  threshold_satisfied: boolean;
  threshold_satisfied_at: string | null;
  commission_rate: number;
  is_above_annual_cap: boolean;
  commissioned_from: string;
  commission_window_ends_at: string;
  pending_commission_cents: number;
  released_commission_cents: number;
  created_at: string;
};

export type AccrualRow = {
  id: string;
  referral_id: string;
  accrual_month: string;
  commission_amount_cents: number;
  state: string;
  created_at: string;
};

export type EligibleAdvocate = {
  id: string;
  email: string | null;
  display_name: string | null;
  advocate_state: string;
};

export type AdminActionRow = {
  id: string;
  action: string;
  target_table: string;
  target_id: string;
  override_reason: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type Props = {
  referrals: ReferralRow[];
  accruals: AccrualRow[];
  eligibleAdvocates: EligibleAdvocate[];
  recentActions: AdminActionRow[];
};

const ACTION_LABEL: Record<string, string> = {
  force_mark_threshold: 'Force-mark threshold',
  force_cancel_accrual: 'Force-cancel accrual',
  force_create_referral: 'Force-create referral',
};

export function OverridesClient({
  referrals,
  accruals,
  eligibleAdvocates,
  recentActions,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function flash(level: 'ok' | 'err', message: string) {
    if (level === 'ok') {
      setSuccess(message);
      setError(null);
    } else {
      setError(message);
      setSuccess(null);
    }
    setTimeout(() => {
      setSuccess(null);
      setError(null);
    }, 4000);
  }

  async function reload() {
    if (typeof window !== 'undefined') {
      startTransition(() => {
        window.location.reload();
      });
    }
  }

  async function onMarkThreshold(referralId: string) {
    const reason = window.prompt(
      'Reason for force-marking threshold (≥12 chars). This will be persisted in the audit log.',
      '',
    );
    if (reason === null) return;
    const res = await fetch('/api/admin/overrides/mark-threshold', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referral_id: referralId, reason }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      flash('err', body.error ?? `HTTP ${res.status}`);
      return;
    }
    flash('ok', 'threshold force-marked');
    await reload();
  }

  async function onCancelAccrual(accrualId: string) {
    const reason = window.prompt(
      'Reason for force-cancelling this pending accrual (≥12 chars). Persisted in the audit log.',
      '',
    );
    if (reason === null) return;
    const res = await fetch('/api/admin/overrides/cancel-accrual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accrual_id: accrualId, reason }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      flash('err', body.error ?? `HTTP ${res.status}`);
      return;
    }
    flash('ok', 'accrual cancelled');
    await reload();
  }

  async function onCreateReferral(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const advocate_user_id = String(data.get('advocate_user_id') ?? '');
    const referred_user_email = String(data.get('referred_user_email') ?? '').trim();
    const reason = String(data.get('reason') ?? '');
    if (!advocate_user_id || !referred_user_email || !reason) {
      flash('err', 'all fields required');
      return;
    }
    const res = await fetch('/api/admin/overrides/create-referral', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ advocate_user_id, referred_user_email, reason }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      flash('err', body.error ?? `HTTP ${res.status}`);
      return;
    }
    flash('ok', 'referral created');
    await reload();
  }

  return (
    <div style={{ padding: '32px 32px 64px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <Link
          href="/admin/advocates"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            textDecoration: 'none',
          }}
        >
          ← Advocate state machine
        </Link>
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 24,
          color: 'var(--ink)',
          margin: '0 0 4px',
        }}
      >
        Overrides &amp; manual operations
      </h1>
      <p
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          color: 'var(--ink-dim)',
          margin: '0 0 24px',
        }}
      >
        Three force-overrides for spec §6.10 cases: streak-counter glitches,
        out-of-band refunds, and conversions the engine missed (the manual
        backfill path until PRs 7-9 ship). Every override writes one
        admin_actions row with the reason you supply.
      </p>

      {error && <Banner kind="err">{error}</Banner>}
      {success && <Banner kind="ok">{success}</Banner>}

      <Section title={`Referrals (${referrals.length})`}>
        {referrals.length === 0 ? (
          <Empty label="No referral rows yet. The engine PRs (7-9) populate this table; until they ship, you can backfill manually with the form below." />
        ) : (
          <Table>
            <Header
              columns={[
                'Advocate',
                'Referred',
                'Status',
                'Threshold',
                'Rate',
                'Window',
                'Action',
              ]}
            />
            {referrals.map((r) => (
              <Row key={r.id}>
                <Cell mono>{r.advocate_email ?? r.advocate_user_id}</Cell>
                <Cell mono>{r.referred_email ?? r.referred_user_id}</Cell>
                <Cell mono>{r.status}</Cell>
                <Cell mono>
                  {r.threshold_satisfied
                    ? `✓ ${r.threshold_satisfied_at?.slice(0, 10) ?? ''}`
                    : '—'}
                </Cell>
                <Cell mono>{(r.commission_rate * 100).toFixed(1)}%</Cell>
                <Cell mono>{r.commission_window_ends_at.slice(0, 10)}</Cell>
                <Cell>
                  {!r.threshold_satisfied &&
                    r.status !== 'cancelled' &&
                    r.status !== 'expired' && (
                      <ActionButton
                        onClick={() => onMarkThreshold(r.id)}
                        disabled={pending}
                      >
                        Force-mark threshold
                      </ActionButton>
                    )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section title={`Pending accruals (${accruals.length})`}>
        {accruals.length === 0 ? (
          <Empty label="No pending accruals. PR 9's monthly cron creates these once it ships." />
        ) : (
          <Table>
            <Header columns={['Referral', 'Accrual month', 'Amount', 'Created', 'Action']} />
            {accruals.map((a) => (
              <Row key={a.id}>
                <Cell mono>{a.referral_id.slice(0, 8)}…</Cell>
                <Cell mono>{a.accrual_month}</Cell>
                <Cell mono align="right">
                  ${(a.commission_amount_cents / 100).toFixed(2)}
                </Cell>
                <Cell mono>{a.created_at.slice(0, 10)}</Cell>
                <Cell>
                  <ActionButton
                    onClick={() => onCancelAccrual(a.id)}
                    disabled={pending}
                  >
                    Force-cancel
                  </ActionButton>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Force-create referral · manual backfill">
        {eligibleAdvocates.length === 0 ? (
          <Empty label="No active or paused advocates yet. Move someone to 'active' on the state-machine page first." />
        ) : (
          <form onSubmit={onCreateReferral} style={{ display: 'grid', gap: 14, maxWidth: 640 }}>
            <FormRow>
              <FormLabel htmlFor="advocate_user_id">Advocate</FormLabel>
              <select
                id="advocate_user_id"
                name="advocate_user_id"
                required
                style={selectStyle}
                defaultValue=""
              >
                <option value="" disabled>
                  Select advocate…
                </option>
                {eligibleAdvocates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email ?? a.id} · {a.advocate_state}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow>
              <FormLabel htmlFor="referred_user_email">Referred user email</FormLabel>
              <input
                id="referred_user_email"
                name="referred_user_email"
                type="email"
                required
                placeholder="email@domain.tld"
                style={inputStyle}
              />
            </FormRow>
            <FormRow>
              <FormLabel htmlFor="reason">Reason (≥12 chars · audit log)</FormLabel>
              <textarea
                id="reason"
                name="reason"
                required
                rows={3}
                minLength={12}
                style={{ ...inputStyle, resize: 'vertical' }}
                placeholder="e.g. Pre-engine backfill: Jane converted 2026-04-21, advocate@example.com onboarded 2026-04-15"
              />
            </FormRow>
            <div>
              <button type="submit" disabled={pending} style={submitStyle}>
                Create referral
              </button>
            </div>
          </form>
        )}
      </Section>

      <Section title="Recent overrides (audit log)">
        {recentActions.length === 0 ? (
          <Empty label="No overrides recorded yet." />
        ) : (
          <Table>
            <Header columns={['When', 'Action', 'Target', 'Reason']} />
            {recentActions.map((a) => (
              <Row key={a.id}>
                <Cell mono>{a.created_at.slice(0, 16).replace('T', ' ')}</Cell>
                <Cell mono>{ACTION_LABEL[a.action] ?? a.action}</Cell>
                <Cell mono>
                  {a.target_table}/{a.target_id.slice(0, 8)}…
                </Cell>
                <Cell>{a.override_reason}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

// ─── Layout primitives (re-implemented locally so this client
//     component stays self-contained; the sister AdvocateAdminClient
//     has the same shapes) ────────────────────────────────────────

function Banner({ kind, children }: { kind: 'ok' | 'err'; children: React.ReactNode }) {
  const palette =
    kind === 'ok'
      ? { bg: 'rgba(25, 208, 184, 0.08)', border: 'rgba(25, 208, 184, 0.4)', fg: 'var(--teal)' }
      : { bg: 'rgba(224, 93, 80, 0.1)', border: 'rgba(224, 93, 80, 0.4)', fg: 'var(--red, #d8654f)' };
  return (
    <div
      role="status"
      style={{
        padding: '10px 14px',
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        borderRadius: 4,
        fontSize: 13,
        marginBottom: 18,
      }}
    >
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          margin: '0 0 10px',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Header({ columns }: { columns: string[] }) {
  return (
    <tr>
      {columns.map((c) => (
        <th
          key={c}
          style={{
            textAlign: 'left',
            padding: '10px 14px',
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            borderBottom: '1px solid var(--rule)',
            background: 'var(--bg-raised)',
          }}
        >
          {c}
        </th>
      ))}
    </tr>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>{children}</tr>;
}

function Cell({
  children,
  mono,
  align,
}: {
  children: React.ReactNode;
  mono?: boolean;
  align?: 'left' | 'right';
}) {
  return (
    <td
      style={{
        padding: '10px 14px',
        fontFamily: mono ? 'var(--f-mono)' : 'var(--f-body)',
        fontSize: 12.5,
        color: 'var(--ink)',
        textAlign: align ?? 'left',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        border: '1px solid var(--rule)',
        padding: '4px 10px',
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--ink-dim)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        borderRadius: 2,
      }}
    >
      {children}
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px dashed var(--rule)',
        borderRadius: 4,
        padding: '14px 16px',
        fontFamily: 'var(--f-body)',
        fontSize: 12.5,
        color: 'var(--ink-faint)',
      }}
    >
      {label}
    </div>
  );
}

function FormRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gap: 6 }}>{children}</div>;
}

function FormLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-dim)',
      }}
    >
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: 'var(--bg-raised)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  fontFamily: 'var(--f-body)',
  fontSize: 13,
  borderRadius: 2,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: 'var(--f-mono)',
};

const submitStyle: React.CSSProperties = {
  background: 'var(--teal)',
  color: 'var(--bg-void)',
  border: '1px solid var(--teal-dim)',
  borderRadius: 2,
  padding: '10px 18px',
  fontFamily: 'var(--f-mono)',
  fontSize: 11.5,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  fontWeight: 600,
  cursor: 'pointer',
};
