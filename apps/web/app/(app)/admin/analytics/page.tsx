import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isFounder } from '@/lib/admin/access';
import { createServerSupabase } from '@/lib/supabase-server';
import { PRICE_VERSION } from '@/lib/costs/prices';

export const metadata: Metadata = {
  title: 'Analytics — eYKON.ai',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const MONO: React.CSSProperties = { fontFamily: 'var(--f-mono)', letterSpacing: '0.08em' };
const usd = (n: number) => `$${Number(n ?? 0).toFixed(4)}`;
const usd2 = (n: number) => `$${Number(n ?? 0).toFixed(2)}`;

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin?next=/admin/analytics');
  if (!isFounder(user)) redirect('/app');

  const admin = createServerSupabase();

  const [pnlRes, featureRes, platformRes, recentRes] = await Promise.all([
    admin
      .from('user_pnl')
      .select('user_id, display_name, handle, revenue_usd, cost_usd, cost_llm_usd, cost_deep_usd, event_count, margin_usd, plan_budget_usd, plan_spent_usd, plan_status, plan_label')
      .order('cost_usd', { ascending: false })
      .limit(50),
    // Cost by feature — attributed AND platform, so the split between
    // "what users cost" and "what the platform costs" is visible.
    admin.from('cost_events').select('feature, category, usd_cost, user_id, billable'),
    admin.from('cost_events').select('usd_cost').is('user_id', null),
    admin
      .from('cost_events')
      .select('feature, model, legs, input_tokens, cache_read_tokens, output_tokens, usd_cost, occurred_at, user_id')
      .order('occurred_at', { ascending: false })
      .limit(15),
  ]);

  const pnl = (pnlRes.data ?? []) as any[];
  const allEvents = (featureRes.data ?? []) as any[];
  const recent = (recentRes.data ?? []) as any[];

  // Aggregate in JS rather than a second view: the volumes here are
  // small and the shape is presentational, not a source of truth.
  const byFeature = new Map<string, { usd: number; n: number }>();
  let totalCost = 0;
  let platformCost = 0;
  let attributedCost = 0;
  for (const e of allEvents) {
    const c = Number(e.usd_cost);
    totalCost += c;
    if (e.user_id === null) platformCost += c;
    else attributedCost += c;
    const cur = byFeature.get(e.feature) ?? { usd: 0, n: 0 };
    cur.usd += c;
    cur.n += 1;
    byFeature.set(e.feature, cur);
  }
  const features = [...byFeature.entries()].sort((a, b) => b[1].usd - a[1].usd);

  const totalRevenue = pnl.reduce((s, r) => s + Number(r.revenue_usd ?? 0), 0);
  const totalMargin = totalRevenue - totalCost;

  return (
    <section style={{ maxWidth: 1200, margin: '0 auto', padding: '30px 22px 60px' }}>
      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 24, margin: '0 0 6px' }}>Analytics</h1>
      <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', margin: '0 0 22px', lineHeight: 1.6, maxWidth: 800 }}>
        What each user costs, what they pay, and the difference. Cost is measured from real token
        usage on every Claude call — not estimated.
      </p>

      {allEvents.length === 0 && (
        <Callout tone="warn">
          <strong>The ledger is empty.</strong> Every number below is a true zero, not a computed
          one. If that is unexpected, the usual cause is a platform-wide LLM outage (an Anthropic
          credit balance at zero returns 400 on every call and writes nothing) — check the Railway
          logs before reading anything here as a result.
        </Callout>
      )}

      {/* ── Headline ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 26 }}>
        <Stat label="Revenue (completed)" value={usd2(totalRevenue)} />
        <Stat label="Variable cost" value={usd2(totalCost)} />
        <Stat label="Contribution margin" value={usd2(totalMargin)} tone={totalMargin >= 0 ? 'good' : 'bad'} />
        <Stat label="Attributed to users" value={usd2(attributedCost)} />
        <Stat label="Platform overhead" value={usd2(platformCost)} />
      </div>

      <Callout>
        <strong>Contribution margin, not profit.</strong> Fixed costs — ingest crons, Railway,
        Supabase base — are deliberately excluded: they are identical with zero users, so blending
        them in would hide which users are genuinely unprofitable behind an averaged overhead. When
        a fixed-cost table lands, it gets its own column rather than being folded into this one.
      </Callout>

      {/* ── Cost by feature ──────────────────────────────────── */}
      <h2 style={{ ...MONO, fontSize: 11, color: 'var(--teal)', margin: '26px 0 10px' }}>
        COST BY FEATURE
      </h2>
      {features.length === 0 ? (
        <Empty>No cost events recorded yet.</Empty>
      ) : (
        <Table head={['Feature', 'Events', 'Total', 'Avg / event', 'Share']}>
          {features.map(([f, v]) => (
            <tr key={f} style={rowStyle}>
              <td style={cell}>{f}</td>
              <td style={{ ...cell, ...MONO }}>{v.n}</td>
              <td style={{ ...cell, ...MONO }}>{usd(v.usd)}</td>
              <td style={{ ...cell, ...MONO }}>{usd(v.usd / v.n)}</td>
              <td style={{ ...cell, ...MONO, color: 'var(--ink-dim)' }}>
                {totalCost > 0 ? `${((v.usd / totalCost) * 100).toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {/* ── Per-user P&L ─────────────────────────────────────── */}
      <h2 style={{ ...MONO, fontSize: 11, color: 'var(--teal)', margin: '30px 0 10px' }}>
        PER-USER PROFITABILITY
      </h2>
      {pnl.length === 0 ? (
        <Empty>No users with revenue, cost or a metered plan yet.</Empty>
      ) : (
        <Table head={['User', 'Revenue', 'Cost', 'Margin', 'Events', 'Test plan']}>
          {pnl.map((r) => {
            const margin = Number(r.margin_usd ?? 0);
            return (
              <tr key={r.user_id} style={rowStyle}>
                <td style={cell}>
                  {r.display_name ?? '—'}
                  {r.handle && <span style={{ ...MONO, fontSize: 10, color: 'var(--ink-dim)' }}> @{r.handle}</span>}
                </td>
                <td style={{ ...cell, ...MONO }}>{usd2(Number(r.revenue_usd ?? 0))}</td>
                <td style={{ ...cell, ...MONO }}>{usd(Number(r.cost_usd ?? 0))}</td>
                <td style={{ ...cell, ...MONO, color: margin >= 0 ? 'var(--teal)' : 'var(--accent, #E0765C)' }}>
                  {usd2(margin)}
                </td>
                <td style={{ ...cell, ...MONO, color: 'var(--ink-dim)' }}>{r.event_count ?? 0}</td>
                <td style={{ ...cell, ...MONO, fontSize: 10, color: 'var(--ink-dim)' }}>
                  {r.plan_budget_usd
                    ? `${usd2(Number(r.plan_spent_usd))} / ${usd2(Number(r.plan_budget_usd))} · ${r.plan_status}`
                    : '—'}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {/* ── Recent events ────────────────────────────────────── */}
      <h2 style={{ ...MONO, fontSize: 11, color: 'var(--teal)', margin: '30px 0 10px' }}>
        RECENT EVENTS
      </h2>
      <p style={{ fontSize: 12, color: 'var(--ink-dim)', margin: '0 0 10px', lineHeight: 1.5, maxWidth: 780 }}>
        <code>legs</code> is the number of API calls inside one turn. A tool-using turn should show
        more than 1 — if it reads 1 on a turn that visibly called tools, the multi-leg accounting has
        regressed and cost is being under-reported.
      </p>
      {recent.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <Table head={['When', 'Feature', 'Model', 'Legs', 'In', 'Cache read', 'Out', 'Cost']}>
          {recent.map((e, i) => (
            <tr key={i} style={rowStyle}>
              <td style={{ ...cell, ...MONO, fontSize: 10 }}>
                {new Date(e.occurred_at).toISOString().slice(5, 16).replace('T', ' ')}
              </td>
              <td style={cell}>{e.feature}</td>
              <td style={{ ...cell, ...MONO, fontSize: 10 }}>{e.model ?? '—'}</td>
              <td style={{ ...cell, ...MONO, color: e.legs > 1 ? 'var(--teal)' : 'var(--ink-dim)' }}>
                {e.legs ?? '—'}
              </td>
              <td style={{ ...cell, ...MONO, fontSize: 10 }}>{e.input_tokens ?? '—'}</td>
              <td style={{ ...cell, ...MONO, fontSize: 10 }}>{e.cache_read_tokens ?? '—'}</td>
              <td style={{ ...cell, ...MONO, fontSize: 10 }}>{e.output_tokens ?? '—'}</td>
              <td style={{ ...cell, ...MONO }}>{usd(Number(e.usd_cost))}</td>
            </tr>
          ))}
        </Table>
      )}

      <p style={{ ...MONO, fontSize: 9.5, color: 'var(--ink-dim)', marginTop: 26 }}>
        RATE CARD {PRICE_VERSION} · SONNET 5 INTRO PRICING ENDS 2026-08-31
      </p>
    </section>
  );
}

// ─── Presentational helpers ────────────────────────────────────
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 3, padding: '12px 14px' }}>
      <div style={{ ...MONO, fontSize: 9, color: 'var(--ink-dim)' }}>{label.toUpperCase()}</div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 20,
          marginTop: 4,
          color: tone === 'bad' ? 'var(--accent, #E0765C)' : tone === 'good' ? 'var(--teal)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Callout({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div
      style={{
        borderLeft: `3px solid ${tone === 'warn' ? '#C98A2E' : 'var(--teal)'}`,
        background: 'var(--bg-void)',
        padding: '10px 14px',
        fontSize: 12.5,
        lineHeight: 1.6,
        color: 'var(--ink-dim)',
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{children}</p>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--rule)' }}>
            {head.map((h) => (
              <th key={h} style={{ ...MONO, fontSize: 9, color: 'var(--ink-dim)', textAlign: 'left', padding: '8px 10px' }}>
                {h.toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const rowStyle: React.CSSProperties = { borderBottom: '1px solid var(--rule-soft)' };
const cell: React.CSSProperties = { padding: '9px 10px' };
