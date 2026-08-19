'use client';

import { useMemo, useState } from 'react';

/**
 * Client view for /admin/subscribers. Mirrors the Fiat Waitlist page's
 * vocabulary (stat cards, inline selects, CSV of the FILTERED set) so the
 * two Growth & Revenue pages read as one surface.
 *
 * Two honesty rules are enforced here rather than left to the reader:
 *   1. Every tile names the population it counts. Passes and subscriptions
 *      sit on one page (D-1), and an aggregate over two populations hides
 *      the smaller one — the label is what stops that being a lie.
 *   2. Attribution renders "—" when absent and never guesses. Rows created
 *      before migration 109 have no campaign data and must look like it.
 */

export type SubscriberRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  type: 'subscription' | 'pass' | 'both';
  tier: string | null;
  cadence: string | null;
  status: 'active' | 'expiring' | 'lapsed' | 'pass_active' | 'pass_expired';
  country: string | null;
  landing_path: string | null;
  referral_code: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  joined_at: string;
  settled_cents: number;
  refunded_cents: number;
  currency: string;
  variant_id: string | null;
  variants: string[];
  payment_provider: string | null;
  pay_currency: string | null;
  founding: boolean;
  renews_at: string | null;
  pass_expires_at: string | null;
  purchase_count: number;
};

export type SubscriberStats = {
  customers: number;
  subscribers: number;
  passOnly: number;
  annual: number;
  monthly: number;
  lapsed: number;
  expiring: number;
  settledCents: number;
  refundedCents: number;
  fromStart: number;
  fromPartner: number;
  attributed: number;
  startedNotCompleted: number;
  cap: number;
  claimed: number;
  paidFounders: number;
  spotsLeft: number;
};

const STATUS_LABEL: Record<SubscriberRow['status'], string> = {
  active: 'active',
  expiring: 'expiring <7d',
  lapsed: 'lapsed',
  pass_active: 'pass active',
  pass_expired: 'pass expired',
};

const STATUS_COLOR: Record<SubscriberRow['status'], string> = {
  active: 'var(--teal)',
  expiring: 'var(--amber, #d9a441)',
  lapsed: 'var(--ink-faint)',
  pass_active: 'var(--teal)',
  pass_expired: 'var(--ink-faint)',
};

const TYPE_LABEL: Record<SubscriberRow['type'], string> = {
  subscription: 'Subscription',
  pass: 'Pass only',
  both: 'Both',
};

function money(cents: number, currency = 'USD'): string {
  return `${currency === 'USD' ? '$' : ''}${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function flag(cc: string | null): string {
  if (!cc || cc.length !== 2) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + (cc.toUpperCase().charCodeAt(0) - 65),
    A + (cc.toUpperCase().charCodeAt(1) - 65),
  );
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV of the FILTERED set, not the whole table — same contract as the
// waitlist export, so what you see is what you get.
function toCsv(rows: SubscriberRow[]): string {
  const head = [
    'email',
    'type',
    'tier',
    'cadence',
    'status',
    'country',
    'landing_path',
    'referral_code',
    'utm_source',
    'utm_campaign',
    'joined_at',
    'settled_usd',
    'refunded_usd',
    'variants',
    'payment_provider',
    'pay_currency',
    'founding',
    'renews_at',
    'pass_expires_at',
    'purchases',
  ];
  const lines = rows.map(r =>
    [
      r.email ?? '',
      r.type,
      r.tier ?? '',
      r.cadence ?? '',
      r.status,
      r.country ?? '',
      r.landing_path ?? '',
      r.referral_code ?? '',
      r.utm_source ?? '',
      r.utm_campaign ?? '',
      r.joined_at,
      (r.settled_cents / 100).toFixed(2),
      (r.refunded_cents / 100).toFixed(2),
      r.variants.join(' | '),
      r.payment_provider ?? '',
      r.pay_currency ?? '',
      r.founding ? 'yes' : 'no',
      r.renews_at ?? '',
      r.pass_expires_at ?? '',
      String(r.purchase_count),
    ]
      .map(csvEscape)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

function downloadCsv(rows: SubscriberRow[]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function SubscribersAdminClient({
  rows,
  stats,
}: {
  rows: SubscriberRow[];
  stats: SubscriberStats;
}) {
  const [type, setType] = useState<'all' | SubscriberRow['type']>('all');
  const [tier, setTier] = useState('all');
  const [status, setStatus] = useState<'all' | SubscriberRow['status']>('all');
  const [country, setCountry] = useState('all');
  const [cadence, setCadence] = useState('all');
  const [source, setSource] = useState('all');
  const [partner, setPartner] = useState('all');
  const [landing, setLanding] = useState('all');
  const [method, setMethod] = useState('all');
  const [rate, setRate] = useState('all');
  const [query, setQuery] = useState('');

  // Filter option lists are derived from the rows themselves — a channel or
  // partner code only appears once someone has actually converted through it.
  // D-6: payment method is likewise built from the data, never a hardcoded
  // 'crypto', so a crypto-only view cannot become a bug the day fiat opens.
  const { countries, sources, partners, tiers, methods } = useMemo(() => {
    const uniq = (pick: (r: SubscriberRow) => string | null): string[] =>
      Array.from(new Set(rows.map(pick).filter((v): v is string => Boolean(v)))).sort();
    return {
      countries: uniq(r => r.country),
      sources: uniq(r => r.utm_source),
      partners: uniq(r => r.referral_code),
      tiers: uniq(r => r.tier),
      methods: uniq(r => r.payment_provider),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (type !== 'all' && r.type !== type) return false;
      if (tier !== 'all' && r.tier !== tier) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (country !== 'all' && r.country !== country) return false;
      if (cadence !== 'all' && r.cadence !== cadence) return false;
      if (source !== 'all' && r.utm_source !== source) return false;
      if (method !== 'all' && r.payment_provider !== method) return false;
      if (partner === 'any' && !r.referral_code) return false;
      if (partner === 'none' && r.referral_code) return false;
      if (partner !== 'all' && partner !== 'any' && partner !== 'none' && r.referral_code !== partner)
        return false;
      if (landing === 'start' && !(r.landing_path ?? '').startsWith('/start')) return false;
      if (landing === 'other' && (r.landing_path ?? '').startsWith('/start')) return false;
      if (landing === 'none' && r.landing_path) return false;
      if (rate === 'founding' && !r.variants.some(v => v.includes('_founding_'))) return false;
      if (rate === 'standard' && r.variants.some(v => v.includes('_founding_'))) return false;
      if (q && !(r.email ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, type, tier, status, country, cadence, source, partner, landing, method, rate, query]);

  return (
    <section
      style={{
        maxWidth: 1400,
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
          ·· Admin · Subscribers ··
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: '-0.5px',
          }}
        >
          Subscribers
        </h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: 13.5, marginTop: 6, maxWidth: 780 }}>
          Everyone whose payment actually settled — one row per customer, built on{' '}
          <code style={{ fontFamily: 'var(--f-mono)', fontSize: 12 }}>purchases</code> so that
          Week Pass buyers appear alongside subscribers. Abandoned checkouts are excluded.
          Attribution is first-touch and only exists for purchases made after migration 109;
          earlier rows show “—”.
        </p>
      </div>

      {/* Stats — every tile names its population */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          marginBottom: 32,
        }}
      >
        <StatCard
          hero
          label="Founding seats left"
          value={stats.spotsLeft.toLocaleString('en-US')}
          sub={`${stats.claimed.toLocaleString('en-US')} of ${stats.cap.toLocaleString('en-US')} claimed · ${stats.paidFounders} paid`}
        />
        <StatCard label="Customers" value={String(stats.customers)} sub="anyone who paid" />
        <StatCard
          label="Subscribers"
          value={String(stats.subscribers)}
          sub={`excl. ${stats.passOnly} pass-only`}
        />
        <StatCard
          label="Annual / monthly"
          value={`${stats.annual} / ${stats.monthly}`}
          sub="subscribers only"
        />
        <StatCard
          label="Settled"
          value={money(stats.settledCents)}
          sub={
            stats.refundedCents > 0
              ? `gross, all customers · ${money(stats.refundedCents)} refunded`
              : 'gross, all customers'
          }
        />
        <StatCard
          label="Lapsed / expiring"
          value={`${stats.lapsed} / ${stats.expiring}`}
          sub="subscribers only"
        />
        <StatCard
          label="From /start"
          value={String(stats.fromStart)}
          sub={`of ${stats.attributed} attributed`}
        />
        <StatCard
          label="From a partner"
          value={String(stats.fromPartner)}
          sub="referral code present"
        />
        <StatCard
          label="Abandoned"
          value={String(stats.startedNotCompleted)}
          sub="started checkout, never paid"
        />
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Select
          label="Type"
          value={type}
          onChange={v => setType(v as typeof type)}
          options={[
            ['all', 'All types'],
            ['subscription', 'Subscription'],
            ['pass', 'Pass only'],
            ['both', 'Both'],
          ]}
        />
        <Select
          label="Tier"
          value={tier}
          onChange={setTier}
          options={[['all', 'All tiers'], ...tiers.map(t => [t, t] as [string, string])]}
        />
        <Select
          label="Status"
          value={status}
          onChange={v => setStatus(v as typeof status)}
          options={[
            ['all', 'All statuses'],
            ['active', 'Active'],
            ['expiring', 'Expiring <7d'],
            ['lapsed', 'Lapsed'],
            ['pass_active', 'Pass active'],
            ['pass_expired', 'Pass expired'],
          ]}
        />
        <Select
          label="Cadence"
          value={cadence}
          onChange={setCadence}
          options={[
            ['all', 'Any cadence'],
            ['annual', 'Annual'],
            ['monthly', 'Monthly'],
          ]}
        />
        <Select
          label="Rate"
          value={rate}
          onChange={setRate}
          options={[
            ['all', 'Any rate'],
            ['founding', 'Founding variant'],
            ['standard', 'Standard variant'],
          ]}
        />
        <Select
          label="Converted from"
          value={landing}
          onChange={setLanding}
          options={[
            ['all', 'Any page'],
            ['start', '/start'],
            ['other', 'Other page'],
            ['none', 'Not recorded'],
          ]}
        />
        <Select
          label="Partner"
          value={partner}
          onChange={setPartner}
          options={[
            ['all', 'Any partner'],
            ['any', 'Has a code'],
            ['none', 'No code'],
            ...partners.map(p => [p, p] as [string, string]),
          ]}
        />
        <Select
          label="Channel"
          value={source}
          onChange={setSource}
          options={[['all', 'Any channel'], ...sources.map(s => [s, s] as [string, string])]}
        />
        <Select
          label="Payment"
          value={method}
          onChange={setMethod}
          options={[['all', 'Any method'], ...methods.map(m => [m, m] as [string, string])]}
        />
        <Select
          label="Country"
          value={country}
          onChange={setCountry}
          options={[
            ['all', 'All countries'],
            ...countries.map(c => [c, `${flag(c)} ${c}`.trim()] as [string, string]),
          ]}
        />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search email…"
          style={{
            flex: '1 1 200px',
            minWidth: 160,
            padding: '8px 10px',
            fontSize: 13,
            background: 'var(--bg-void)',
            border: '1px solid var(--rule)',
            borderRadius: 4,
            color: 'var(--ink)',
          }}
        />
        <button
          type="button"
          onClick={() => downloadCsv(filtered)}
          disabled={filtered.length === 0}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: filtered.length === 0 ? 'var(--ink-faint)' : 'var(--ink)',
            background: 'transparent',
            border: '1px solid var(--rule-strong)',
            borderRadius: 4,
            padding: '9px 14px',
            cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          ↓ CSV ({filtered.length})
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState hasAnyRows={rows.length > 0} abandoned={stats.startedNotCompleted} />
      ) : (
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule-soft)',
            borderRadius: 6,
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {[
                  'Customer',
                  'Type',
                  'Tier',
                  'Status',
                  'Country',
                  'From',
                  'Partner',
                  'Channel',
                  'Payment',
                  'Joined',
                  'Settled',
                  'Renews',
                ].map(h => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px',
                      fontFamily: 'var(--f-mono)',
                      fontSize: 9.5,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-faint)',
                      borderBottom: '1px solid var(--rule-soft)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <Row key={r.user_id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * The page ships before the data exists (§22.9), so "nobody has paid yet"
 * must be legible as a fact about the business and not as a broken page.
 */
function EmptyState({ hasAnyRows, abandoned }: { hasAnyRows: boolean; abandoned: number }) {
  return (
    <div
      style={{
        padding: '28px 20px',
        background: 'var(--bg-panel)',
        border: '1px dashed var(--rule-soft)',
        borderRadius: 6,
        color: 'var(--ink-dim)',
        fontSize: 13.5,
        lineHeight: 1.6,
      }}
    >
      {hasAnyRows ? (
        <>No customers match these filters.</>
      ) : (
        <>
          <strong style={{ color: 'var(--ink)' }}>No completed purchases yet.</strong>
          <br />
          This is the page working, not the page failing — a customer appears here the moment a
          payment settles.
          {abandoned > 0 && (
            <>
              {' '}
              {abandoned} {abandoned === 1 ? 'account has' : 'accounts have'} started a checkout
              without completing one.
            </>
          )}
        </>
      )}
    </div>
  );
}

function Row({ row }: { row: SubscriberRow }) {
  const td: React.CSSProperties = {
    padding: '11px 14px',
    borderBottom: '1px solid var(--rule-soft)',
    verticalAlign: 'top',
    whiteSpace: 'nowrap',
  };
  const dim = { color: 'var(--ink-faint)' };
  return (
    <tr>
      <td style={{ ...td, whiteSpace: 'normal', minWidth: 200 }}>
        <CopyEmail email={row.email} />
        {row.display_name && (
          <div style={{ fontSize: 11, ...dim, marginTop: 2 }}>{row.display_name}</div>
        )}
      </td>
      <td style={td}>
        {TYPE_LABEL[row.type]}
        {row.purchase_count > 1 && (
          <span style={{ fontSize: 11, ...dim }}> ·{row.purchase_count}</span>
        )}
      </td>
      <td style={td}>
        {row.tier ?? <span style={dim}>—</span>}
        {row.cadence && <div style={{ fontSize: 11, ...dim }}>{row.cadence}</div>}
        {/*
          Two different questions that both want the word "founding":
          the VARIANT is what they bought, founding_rate_locked is whether a
          seat was consumed. They can disagree — support@eykon.ai holds a
          pro_founding_annual purchase with founding_rate_locked = false — so
          each is labelled for the question it actually answers.
        */}
        <div style={{ fontSize: 10.5, ...dim, fontFamily: 'var(--f-mono)' }}>
          {row.variants.join(', ') || '—'}
        </div>
        {row.founding && (
          <div style={{ fontSize: 10.5, color: 'var(--teal)', letterSpacing: '0.08em' }}>
            SEAT LOCKED
          </div>
        )}
      </td>
      <td style={{ ...td, color: STATUS_COLOR[row.status] }}>{STATUS_LABEL[row.status]}</td>
      <td style={td}>
        {row.country ? `${flag(row.country)} ${row.country}` : <span style={dim}>—</span>}
      </td>
      <td style={{ ...td, fontFamily: 'var(--f-mono)', fontSize: 11.5 }}>
        {row.landing_path ?? <span style={dim}>—</span>}
      </td>
      <td style={{ ...td, fontFamily: 'var(--f-mono)', fontSize: 11.5 }}>
        {row.referral_code ?? <span style={dim}>—</span>}
      </td>
      <td style={{ ...td, fontFamily: 'var(--f-mono)', fontSize: 11.5 }}>
        {row.utm_source ?? <span style={dim}>—</span>}
        {row.utm_campaign && <div style={{ fontSize: 10.5, ...dim }}>{row.utm_campaign}</div>}
      </td>
      <td style={{ ...td, fontSize: 11.5 }}>
        {row.payment_provider ?? <span style={dim}>—</span>}
        {row.pay_currency && (
          <div style={{ fontSize: 10.5, ...dim }}>{row.pay_currency.toUpperCase()}</div>
        )}
      </td>
      <td style={td}>{formatDate(row.joined_at)}</td>
      <td style={td}>
        {money(row.settled_cents, row.currency)}
        {row.refunded_cents > 0 && (
          <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
            −{money(row.refunded_cents, row.currency)} refunded
          </div>
        )}
      </td>
      <td style={td}>
        {row.type === 'pass' ? (
          row.pass_expires_at ? (
            formatDate(row.pass_expires_at)
          ) : (
            <span style={dim}>—</span>
          )
        ) : (
          formatDate(row.renews_at)
        )}
      </td>
    </tr>
  );
}

function CopyEmail({ email }: { email: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!email) return <span style={{ color: 'var(--ink-faint)' }}>—</span>;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(email).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {},
        );
      }}
      title="Click to copy"
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        color: copied ? 'var(--teal)' : 'var(--ink)',
        fontFamily: 'inherit',
        fontSize: 13,
        textAlign: 'left',
      }}
    >
      {copied ? 'copied ✓' : email}
    </button>
  );
}

function StatCard({
  label,
  value,
  sub,
  hero,
}: {
  label: string;
  value: string;
  sub?: string;
  hero?: boolean;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: `1px solid ${hero ? 'var(--teal)' : 'var(--rule-soft)'}`,
        borderRadius: 6,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 9.5,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: hero ? 'var(--teal)' : 'var(--ink-faint)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: hero ? 30 : 22,
          fontWeight: 600,
          color: 'var(--ink)',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 9,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
        }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '7px 10px',
          fontSize: 13,
          background: 'var(--bg-void)',
          border: '1px solid var(--rule)',
          borderRadius: 4,
          color: 'var(--ink)',
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
