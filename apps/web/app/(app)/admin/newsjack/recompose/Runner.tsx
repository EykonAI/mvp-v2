'use client';

import { useState } from 'react';

// Dry-run recompose viewer. Calls the founder-gated route, renders the two
// versions side by side, and says on every row whether the event is still
// inside a newsjacking window. The route has no commit path, so no draft can
// be created or changed from here; the only thing a run writes is its own
// cost_events rows. The worst outcome of clicking Run is a bill for a few
// cents of Sonnet.

interface Row {
  draftId: string;
  skipped?: string;
  region?: string | null;
  domain?: string | null;
  severity?: string | null;
  framing?: string;
  ageHours?: number;
  stale?: boolean;
  publishable?: string;
  before?: string[];
  after?: string[];
  composer?: string;
  model?: string | null;
  register?: string;
  attempts?: number;
  fallbackReason?: string | null;
  craftWarnings?: string[];
}

interface Report {
  days: number;
  limit: number;
  register: string;
  codexVersion: string;
  dryRun: boolean;
  note: string;
  scanned: number;
  composedByAgent: number;
  fellBack: number;
  results: Row[];
  error?: string;
}

const meta: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--ink-faint)',
};

export default function Runner() {
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState(10);
  const [register, setRegister] = useState('dry');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  async function save(r: Row) {
    setSaved((m) => ({ ...m, [r.draftId]: 'saving…' }));
    try {
      const res = await fetch('/api/admin/newsjack/recompose/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          draftId: r.draftId,
          posts: r.after ?? [],
          composer: r.composer,
          model: r.model,
        }),
      });
      const j = await res.json();
      setSaved((m) => ({
        ...m,
        [r.draftId]: res.ok
          ? `saved as revision ${j.revision} — publish it on /admin/newsjack`
          : `refused: ${j.error}${j.violations ? ' — ' + j.violations.join('; ') : ''}`,
      }));
    } catch (e: any) {
      setSaved((m) => ({ ...m, [r.draftId]: `failed: ${e?.message ?? 'request error'}` }));
    }
  }

  async function run() {
    setBusy(true);
    setErr(null);
    setReport(null);
    try {
      const res = await fetch(
        `/api/admin/newsjack/recompose?days=${days}&limit=${limit}&register=${register}`,
        {
          method: 'POST',
        },
      );
      const json = (await res.json()) as Report;
      if (!res.ok) setErr(json.error ?? `HTTP ${res.status}`);
      else setReport(json);
    } catch (e: any) {
      setErr(e?.message ?? 'request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        <label style={{ ...meta, display: 'flex', flexDirection: 'column', gap: 4 }}>
          days back
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ width: 80, padding: '6px 8px', fontSize: 13, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 6 }}
          />
        </label>
        <label style={{ ...meta, display: 'flex', flexDirection: 'column', gap: 4 }}>
          max drafts
          <input
            type="number"
            min={1}
            max={30}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            style={{ width: 80, padding: '6px 8px', fontSize: 13, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 6 }}
          />
        </label>
        <label style={{ ...meta, display: 'flex', flexDirection: 'column', gap: 4 }}>
          register
          <select
            value={register}
            onChange={(e) => setRegister(e.target.value)}
            style={{ padding: '6px 8px', fontSize: 13, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 6 }}
          >
            <option value="flat">flat</option>
            <option value="dry">dry</option>
            <option value="open">open</option>
          </select>
        </label>
        <button
          onClick={run}
          disabled={busy}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            borderRadius: 6,
            border: '1px solid var(--teal)',
            background: busy ? 'transparent' : 'var(--teal)',
            color: busy ? 'var(--ink-dim)' : '#fff',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Composing…' : 'Run dry recompose'}
        </button>
        <span style={{ ...meta, color: 'var(--ink-dim)' }}>changes no drafts · ~1 model call each · cost is ledgered</span>
      </div>

      {err && <div style={{ fontSize: 13, color: 'var(--amber)', marginBottom: 16 }}>Error: {err}</div>}

      {report && (
        <>
          <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 6 }}>
            {report.scanned} draft{report.scanned === 1 ? '' : 's'} · {report.composedByAgent} by the agent ·{' '}
            {report.fellBack} fell back · register {report.register} · codex {report.codexVersion}
          </div>
          <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 20 }}>{report.note}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {report.results.map((r) => (
              <div key={r.draftId} style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 16px' }}>
                {r.skipped ? (
                  <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
                    <span style={meta}>skipped</span> · {r.region ?? 'unknown region'} — {r.skipped}
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
                      <span style={{ ...meta, color: r.composer === 'agent' ? 'var(--teal)' : 'var(--ink-faint)' }}>
                        {r.composer}
                      </span>
                      <span style={meta}>{r.severity ?? '?'} · {r.domain ?? '?'}</span>
                      <span style={meta}>{r.region ?? 'unknown region'}</span>
                      <span style={meta}>{r.framing}</span>
                      <span style={{ ...meta, color: r.stale ? 'var(--amber)' : 'var(--teal)' }}>
                        {r.ageHours}h old — {r.publishable}
                      </span>
                      {r.register && <span style={{ ...meta, marginLeft: 'auto' }}>register {r.register}</span>}
                    </div>

                    {r.fallbackReason && (
                      <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 10 }}>
                        Fell back: {r.fallbackReason}
                      </div>
                    )}
                    {r.craftWarnings && r.craftWarnings.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 10 }}>
                        Craft notes: {r.craftWarnings.join(' · ')}
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
                      <Column label="before — template" posts={r.before ?? []} dim />
                      <Column label={`after — ${r.composer}`} posts={r.after ?? []} />
                    </div>

                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                      <button
                        onClick={() => save(r)}
                        disabled={!!saved[r.draftId]}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          borderRadius: 6,
                          border: '1px solid var(--teal)',
                          background: 'transparent',
                          color: 'var(--teal)',
                          cursor: saved[r.draftId] ? 'default' : 'pointer',
                        }}
                      >
                        Save to queue
                      </button>
                      <button
                        onClick={() => void navigator.clipboard?.writeText((r.after ?? []).join('\n\n'))}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          borderRadius: 6,
                          border: '1px solid var(--rule)',
                          background: 'transparent',
                          color: 'var(--ink-dim)',
                          cursor: 'pointer',
                        }}
                      >
                        Copy
                      </button>
                      {r.stale && !saved[r.draftId] && (
                        <span style={{ ...meta, color: 'var(--amber)' }}>
                          window closed — saving does not make it current
                        </span>
                      )}
                      {saved[r.draftId] && (
                        <span
                          style={{
                            ...meta,
                            color: saved[r.draftId].startsWith('saved') ? 'var(--teal)' : 'var(--amber)',
                            textTransform: 'none',
                          }}
                        >
                          {saved[r.draftId]}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Column({ label, posts, dim }: { label: string; posts: string[]; dim?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...meta, marginBottom: 6 }}>{label}</div>
      <ol style={{ listStyle: 'decimal', paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {posts.map((p, i) => (
          <li
            key={i}
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: dim ? 'var(--ink-dim)' : 'var(--ink)',
              overflowWrap: 'anywhere',
            }}
          >
            {p}
          </li>
        ))}
      </ol>
    </div>
  );
}
