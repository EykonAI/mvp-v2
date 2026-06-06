'use client';
import { useMemo, useState } from 'react';

export type WaitlistRow = {
  id: string;
  email: string | null;
  tier: 'pro' | 'enterprise';
  note: string | null;
  referral_code: string | null;
  country: string | null;
  confirmed_email: boolean;
  notified_at: string | null;
  converted_user_id: string | null;
  created_at: string;
};

export type WaitlistStats = {
  total: number;
  pro: number;
  enterprise: number;
  confirmed: number;
  notified: number;
  converted: number;
  cap: number;
  claimed: number;
  paidFounders: number;
  reservedWaitlist: number;
  spotsLeft: number;
};

type Status = 'pending' | 'confirmed' | 'notified' | 'converted';

function statusOf(row: WaitlistRow): Status {
  if (row.converted_user_id) return 'converted';
  if (row.notified_at) return 'notified';
  if (row.confirmed_email) return 'confirmed';
  return 'pending';
}

const STATUS_COLOR: Record<Status, string> = {
  pending: 'var(--ink-faint)',
  confirmed: 'var(--teal)',
  notified: 'var(--amber)',
  converted: 'var(--green, var(--teal))',
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

// ISO-3166 alpha-2 → regional-indicator flag emoji. Empty string if unknown.
function flag(cc: string | null): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map(ch => base + ch.charCodeAt(0) - 65),
  );
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV of the (filtered) set. Deliberately excludes ip_hash + user_agent —
// they aren't fetched into the dashboard at all, and must never be exported.
function toCsv(rows: WaitlistRow[]): string {
  const headers = [
    'email',
    'tier',
    'country',
    'status',
    'referral_code',
    'note',
    'confirmed_email',
    'notified_at',
    'converted',
    'created_at',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.email ?? '',
        r.tier,
        r.country ?? '',
        statusOf(r),
        r.referral_code ?? '',
        r.note ?? '',
        r.confirmed_email ? 'true' : 'false',
        r.notified_at ?? '',
        r.converted_user_id ? 'true' : 'false',
        r.created_at,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n');
}

function downloadCsv(rows: WaitlistRow[]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fiat-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function WaitlistAdminClient({
  entries,
  stats,
}: {
  entries: WaitlistRow[];
  stats: WaitlistStats;
}) {
  const [tier, setTier] = useState<'all' | 'pro' | 'enterprise'>('all');
  const [status, setStatus] = useState<'all' | Status>('all');
  const [country, setCountry] = useState<string>('all');
  const [query, setQuery] = useState('');

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.country) set.add(e.country);
    return [...set].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(e => {
      if (tier !== 'all' && e.tier !== tier) return false;
      if (status !== 'all' && statusOf(e) !== status) return false;
      if (country !== 'all' && (e.country ?? '') !== country) return false;
      if (q && !(e.email ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, tier, status, country, query]);

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
          ·· Admin · Waitlist ··
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: '-0.5px',
          }}
        >
          Fiat billing waitlist
        </h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: 13.5, marginTop: 6, maxWidth: 720 }}>
          Demand captured while Lemon Squeezy (fiat) is still being built. Crypto buyers
          check out immediately and never appear here. Country is resolved from the edge
          geo header at signup — rows from before that shipped show "—".
        </p>
      </div>

      {/* Stats */}
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
          sub={`${stats.claimed.toLocaleString('en-US')} of ${stats.cap.toLocaleString('en-US')} claimed · ${stats.paidFounders} paid + ${stats.reservedWaitlist} reserved`}
        />
        <StatCard label="On waitlist" value={String(stats.total)} sub="all fiat entries" />
        <StatCard label="Pro / Enterprise" value={`${stats.pro} / ${stats.enterprise}`} sub="by tier" />
        <StatCard label="Confirmed" value={String(stats.confirmed)} sub="double opt-in" />
        <StatCard label="Notified" value={String(stats.notified)} sub="payment link sent" />
        <StatCard label="Converted" value={String(stats.converted)} sub="became founders" />
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
          label="Tier"
          value={tier}
          onChange={v => setTier(v as typeof tier)}
          options={[
            ['all', 'All tiers'],
            ['pro', 'Pro'],
            ['enterprise', 'Enterprise'],
          ]}
        />
        <Select
          label="Status"
          value={status}
          onChange={v => setStatus(v as typeof status)}
          options={[
            ['all', 'All statuses'],
            ['pending', 'Pending'],
            ['confirmed', 'Confirmed'],
            ['notified', 'Notified'],
            ['converted', 'Converted'],
          ]}
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
          No waitlist entries match these filters.
        </div>
      ) : (
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--rule-soft)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Email', 'Tier', 'Country', 'Status', 'Referral', 'Joined', 'Note'].map(h => (
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
                <Row key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ row }: { row: WaitlistRow }) {
  const st = statusOf(row);
  return (
    <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
      <td style={{ padding: '10px 14px' }}>
        <CopyEmail email={row.email} />
      </td>
      <td style={{ padding: '10px 14px', color: 'var(--ink-dim)' }}>
        {row.tier === 'enterprise' ? 'Enterprise' : 'Pro'}
      </td>
      <td style={{ padding: '10px 14px', color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}>
        {row.country ? `${flag(row.country)} ${row.country}`.trim() : '—'}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: STATUS_COLOR[st],
            border: `1px solid ${STATUS_COLOR[st]}`,
            borderRadius: 3,
            padding: '2px 7px',
          }}
        >
          {st}
        </span>
      </td>
      <td
        style={{
          padding: '10px 14px',
          color: 'var(--ink-faint)',
          fontFamily: 'var(--f-mono)',
          fontSize: 11.5,
        }}
      >
        {row.referral_code ?? '—'}
      </td>
      <td style={{ padding: '10px 14px', color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}>
        {formatDate(row.created_at)}
      </td>
      <td style={{ padding: '10px 14px', color: 'var(--ink-faint)', maxWidth: 220 }}>
        {row.note ? (
          <span title={row.note} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.note}
          </span>
        ) : (
          '—'
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
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 6 }}>{sub}</div>
      )}
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
