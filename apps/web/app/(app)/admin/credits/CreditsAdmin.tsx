'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type PlanRow = {
  user_id: string;
  label: string | null;
  budget_usd: number;
  spent_usd: number;
  deep_cap_pct: number;
  deep_spent_usd: number;
  status: 'active' | 'exhausted' | 'suspended';
  created_at: string;
  name: string;
  handle: string | null;
};

const MONO: React.CSSProperties = { fontFamily: 'var(--f-mono)', letterSpacing: '0.08em' };
const usd = (n: number) => `$${Number(n).toFixed(2)}`;

export default function CreditsAdmin({ plans }: { plans: PlanRow[] }) {
  const router = useRouter();
  const [lookup, setLookup] = useState('');
  const [budget, setBudget] = useState('10.00');
  const [label, setLabel] = useState('');
  const [deepPct, setDeepPct] = useState('20');
  const [days, setDays] = useState('90');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function call(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json.error ?? `Failed (${res.status}).`);
      } else {
        setMsg(
          action === 'grant' || action === 'top_up'
            ? `${json.was_existing ? 'Topped up' : 'Granted'} — budget now ${usd(json.budget_usd)}, spent ${usd(json.spent_usd)}.`
            : 'Done.',
        );
        router.refresh();
      }
    } catch (err: any) {
      setMsg(err?.message ?? 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* ── Grant form ─────────────────────────────────────────── */}
      <section
        style={{
          border: '1px solid var(--rule)',
          borderRadius: 3,
          padding: 18,
          background: 'var(--bg-panel, transparent)',
        }}
      >
        <h2 style={{ ...MONO, fontSize: 11, color: 'var(--teal)', margin: '0 0 4px' }}>
          GRANT A TEST PLAN
        </h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: '0 0 14px', lineHeight: 1.5 }}>
          Grants Pro entitlements plus a metered Claude budget in one transaction. Re-granting the
          same person <strong>tops up</strong> rather than duplicating. The budget is per-plan — the
          $10 default is a starting point, not a rule.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="@handle or email" width={220}>
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="@wcontxt"
              style={inputStyle}
            />
          </Field>
          <Field label="budget USD" width={110}>
            <input
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="decimal"
              style={inputStyle}
            />
          </Field>
          <Field label="deep cap %" width={100}>
            <input
              value={deepPct}
              onChange={(e) => setDeepPct(e.target.value)}
              inputMode="numeric"
              style={inputStyle}
            />
          </Field>
          <Field label="days of Pro" width={100}>
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              style={inputStyle}
            />
          </Field>
          <Field label="label" width={200}>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="FP test — W/Contxt"
              style={inputStyle}
            />
          </Field>
          <button
            disabled={busy || !lookup.trim()}
            onClick={() =>
              void call('grant', {
                lookup: lookup.trim(),
                budget_usd: Number(budget),
                label: label.trim() || null,
                deep_cap_pct: Number(deepPct) / 100,
                days: Number(days),
              })
            }
            style={{ ...btnStyle, opacity: busy || !lookup.trim() ? 0.5 : 1 }}
          >
            {busy ? 'working…' : 'Grant / top up'}
          </button>
        </div>

        {msg && (
          <p style={{ ...MONO, fontSize: 11, marginTop: 12, color: 'var(--ink)' }}>{msg}</p>
        )}
      </section>

      {/* ── Live plans ─────────────────────────────────────────── */}
      <section>
        <h2 style={{ ...MONO, fontSize: 11, color: 'var(--teal)', margin: '0 0 10px' }}>
          ACTIVE TEST PLANS ({plans.length})
        </h2>

        {plans.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
            No metered plans yet. Everyone else is unmetered and governed by their tier&rsquo;s query
            limits, exactly as before.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--rule)' }}>
                  {['Partner', 'Plan', 'Used', 'Deep', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      style={{ ...MONO, fontSize: 9.5, color: 'var(--ink-dim)', textAlign: 'left', padding: '8px 10px' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const pct = p.budget_usd > 0 ? (p.spent_usd / p.budget_usd) * 100 : 0;
                  const deepCap = p.budget_usd * p.deep_cap_pct;
                  const colour =
                    p.status !== 'active'
                      ? 'var(--accent, #E0765C)'
                      : pct >= 75
                      ? '#C98A2E'
                      : 'var(--ink)';
                  return (
                    <tr key={p.user_id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                      <td style={{ padding: '9px 10px' }}>
                        {p.name}
                        {p.handle && (
                          <span style={{ ...MONO, fontSize: 10, color: 'var(--ink-dim)' }}> @{p.handle}</span>
                        )}
                        {p.label && (
                          <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>{p.label}</div>
                        )}
                      </td>
                      <td style={{ ...MONO, padding: '9px 10px' }}>{usd(p.budget_usd)}</td>
                      <td style={{ ...MONO, padding: '9px 10px', color: colour }}>
                        {usd(p.spent_usd)} · {pct.toFixed(0)}%
                      </td>
                      <td style={{ ...MONO, padding: '9px 10px', color: 'var(--ink-dim)' }}>
                        {usd(p.deep_spent_usd)} / {usd(deepCap)}
                      </td>
                      <td style={{ ...MONO, padding: '9px 10px', color: colour }}>{p.status}</td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void call('top_up', { lookup: p.handle ?? p.user_id, budget_usd: 10 })
                          }
                          style={smallBtn}
                        >
                          +$10
                        </button>{' '}
                        <button
                          disabled={busy}
                          onClick={() =>
                            void call(p.status === 'suspended' ? 'resume' : 'suspend', {
                              lookup: p.handle ?? p.user_id,
                            })
                          }
                          style={smallBtn}
                        >
                          {p.status === 'suspended' ? 'resume' : 'pause'}
                        </button>{' '}
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove the metered plan for ${p.name}?\n\nThey revert to UNMETERED — their tier stays, and the analyst stops being capped. Spend history and the grant audit trail are kept.`,
                              )
                            ) {
                              void call('revoke', { lookup: p.handle ?? p.user_id });
                            }
                          }}
                          style={{ ...smallBtn, color: 'var(--accent, #E0765C)' }}
                        >
                          revoke
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  width,
  children,
}: {
  label: string;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width }}>
      <span style={{ ...MONO, fontSize: 9, color: 'var(--ink-dim)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-void)',
  border: '1px solid var(--rule)',
  borderRadius: 2,
  padding: '7px 9px',
  color: 'var(--ink)',
  fontSize: 13,
  width: '100%',
};

const btnStyle: React.CSSProperties = {
  ...MONO,
  fontSize: 10,
  padding: '9px 16px',
  borderRadius: 2,
  border: '1px solid var(--teal)',
  background: 'var(--teal)',
  color: 'var(--bg-void)',
  cursor: 'pointer',
};

const smallBtn: React.CSSProperties = {
  ...MONO,
  fontSize: 9,
  padding: '4px 7px',
  borderRadius: 2,
  border: '1px solid var(--rule)',
  background: 'transparent',
  color: 'var(--ink-dim)',
  cursor: 'pointer',
};
