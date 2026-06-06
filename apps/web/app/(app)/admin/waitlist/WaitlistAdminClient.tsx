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
  unsubscribed_at: string | null;
  created_at: string;
};

export type WaitlistStats = {
  total: number;
  pro: number;
  enterprise: number;
  confirmed: number;
  notified: number;
  converted: number;
  unsubscribed: number;
  cap: number;
  claimed: number;
  paidFounders: number;
  reservedWaitlist: number;
  spotsLeft: number;
};

type Status = 'pending' | 'confirmed' | 'notified' | 'converted' | 'unsubscribed';

function statusOf(row: WaitlistRow): Status {
  if (row.unsubscribed_at) return 'unsubscribed';
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
  unsubscribed: 'var(--red, #e0566a)',
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
  const [broadcastOpen, setBroadcastOpen] = useState(false);

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
        <StatCard label="Unsubscribed" value={String(stats.unsubscribed)} sub="opted out" />
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
            ['unsubscribed', 'Unsubscribed'],
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
        <button
          type="button"
          onClick={() => setBroadcastOpen(true)}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--teal)',
            border: '1px solid var(--teal)',
            borderRadius: 4,
            padding: '9px 14px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          ✉ Email contacts
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

      {broadcastOpen && (
        <BroadcastModal
          filters={{ tier, status, country, email: query.trim() }}
          onClose={() => setBroadcastOpen(false)}
        />
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

type PreviewData = {
  matching: number;
  already_sent: number;
  recipient_count: number;
  capped: number;
  dry_run: boolean;
};

type SendResultData = {
  sent: number;
  failed: number;
  skipped_already_sent: number;
  capped_not_sent: number;
  dry_run: boolean;
};

// Founder-composed transactional broadcast. Enforces the brief's guardrail:
// compose → preview the REAL recipient count → explicit confirm. Editing the
// subject/body after a preview clears it, so the count shown can never be
// stale relative to what gets sent. Nothing fires on open or on a single click.
function BroadcastModal({
  filters,
  onClose,
}: {
  filters: { tier: string; status: string; country: string; email: string };
  onClose: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<SendResultData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjectOk = subject.trim().length >= 3 && subject.trim().length <= 200;
  const bodyOk = body.trim().length >= 10 && body.trim().length <= 5000;
  const canCompose = subjectOk && bodyOk;

  async function call(extra: Record<string, unknown>) {
    const res = await fetch('/api/admin/waitlist/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject, body, filters, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data?.error as string) ?? 'Request failed.');
    return data;
  }

  async function onPreview() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      setPreview((await call({ preview: true })) as PreviewData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    setError(null);
    setBusy(true);
    try {
      setResult((await call({})) as SendResultData);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed.');
    } finally {
      setBusy(false);
    }
  }

  const filterSummary = `tier=${filters.tier} · status=${filters.status} · country=${filters.country}${
    filters.email ? ` · email~"${filters.email}"` : ''
  }`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4, 8, 16, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--bg-panel)',
          border: '1px solid var(--rule-strong)',
          borderRadius: 8,
          padding: '24px 26px',
          color: 'var(--ink)',
        }}
      >
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 6 }}>
          ·· Broadcast · transactional ··
        </div>
        <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>
          Email waitlist contacts
        </h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: '0 0 4px', lineHeight: 1.5 }}>
          Sends one email per contact matching the current filters. Unsubscribed contacts are
          always excluded, every email carries an unsubscribe link, and re-sending the same
          message never double-delivers.
        </p>
        <p style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-faint)', margin: '0 0 16px' }}>
          {filterSummary}
        </p>

        {result ? (
          <div
            style={{
              background: 'var(--bg-void)',
              border: '1px solid var(--teal)',
              borderRadius: 6,
              padding: 16,
              fontSize: 13,
              lineHeight: 1.7,
            }}
          >
            <strong style={{ color: 'var(--teal)' }}>
              {result.dry_run ? 'Dry run complete (logged, not sent).' : 'Broadcast sent.'}
            </strong>
            <div style={{ marginTop: 8, color: 'var(--ink-dim)' }}>
              {result.dry_run ? 'Logged' : 'Sent'}: <strong>{result.sent}</strong> · Failed:{' '}
              <strong>{result.failed}</strong> · Skipped (already received):{' '}
              <strong>{result.skipped_already_sent}</strong>
              {result.capped_not_sent > 0 && (
                <>
                  {' '}· Not sent (run cap):{' '}
                  <strong style={{ color: 'var(--amber)' }}>{result.capped_not_sent}</strong>
                </>
              )}
            </div>
            {result.capped_not_sent > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--amber)' }}>
                {result.capped_not_sent} recipient(s) exceeded the per-run cap — run again to send
                the remainder (idempotency prevents duplicates).
              </div>
            )}
          </div>
        ) : (
          <>
            <Field label={`Subject (${subject.trim().length}/200)`}>
              <input
                type="text"
                value={subject}
                onChange={e => {
                  setSubject(e.target.value.slice(0, 200));
                  setPreview(null);
                }}
                placeholder="Fiat billing is now open — claim your founding rate"
                style={inputStyle}
              />
            </Field>
            <Field label={`Body (${body.trim().length}/5000) — blank lines separate paragraphs`}>
              <textarea
                value={body}
                onChange={e => {
                  setBody(e.target.value.slice(0, 5000));
                  setPreview(null);
                }}
                rows={6}
                placeholder={'Hi,\n\nFiat billing is now live. Use the link below to claim your founding rate, locked for life.\n\n— the eYKON team'}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            </Field>

            {error && (
              <div style={{ fontSize: 12.5, color: 'var(--red, #e0566a)', margin: '4px 0 12px' }}>
                {error}
              </div>
            )}

            {preview && (
              <div
                style={{
                  background: 'var(--bg-void)',
                  border: '1px solid var(--rule-soft)',
                  borderRadius: 6,
                  padding: 14,
                  marginBottom: 14,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                Will send to <strong style={{ color: 'var(--teal)' }}>{preview.recipient_count}</strong>{' '}
                contact(s). <span style={{ color: 'var(--ink-faint)' }}>
                  ({preview.matching} match filters · {preview.already_sent} already received this
                  message{preview.capped > 0 ? ` · ${preview.capped} over the per-run cap` : ''})
                </span>
                {preview.dry_run && (
                  <div style={{ marginTop: 8, color: 'var(--amber)', fontSize: 12 }}>
                    ⚠ DRY RUN — emails will be logged, not actually delivered (EMAIL_DRY_RUN /
                    auth disabled).
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={onClose} style={btnGhost}>
                Cancel
              </button>
              {!preview ? (
                <button
                  type="button"
                  onClick={onPreview}
                  disabled={!canCompose || busy}
                  style={canCompose && !busy ? btnPrimary : btnDisabled}
                >
                  {busy ? 'Checking…' : 'Preview recipients →'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={busy || preview.recipient_count === 0}
                  style={busy || preview.recipient_count === 0 ? btnDisabled : btnSend}
                >
                  {busy
                    ? 'Sending…'
                    : preview.dry_run
                      ? `Dry-run ${preview.recipient_count} →`
                      : `Send to ${preview.recipient_count} →`}
                </button>
              )}
            </div>
          </>
        )}

        {result && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" onClick={onClose} style={btnPrimary}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span
        style={{
          display: 'block',
          fontFamily: 'var(--f-mono)',
          fontSize: 9.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          marginBottom: 5,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  fontSize: 13.5,
  background: 'var(--bg-void)',
  border: '1px solid var(--rule)',
  borderRadius: 4,
  color: 'var(--ink)',
};

const btnBase: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11.5,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  borderRadius: 4,
  padding: '10px 16px',
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  ...btnBase,
  color: 'var(--ink-dim)',
  background: 'transparent',
  border: '1px solid var(--rule-strong)',
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  border: '1px solid var(--teal)',
};

const btnSend: React.CSSProperties = {
  ...btnBase,
  color: '#fff',
  background: 'var(--red, #e0566a)',
  border: '1px solid var(--red, #e0566a)',
};

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  color: 'var(--ink-faint)',
  background: 'var(--rule-soft)',
  border: '1px solid var(--rule-soft)',
  cursor: 'not-allowed',
};
