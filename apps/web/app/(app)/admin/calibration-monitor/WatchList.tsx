'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { WATCH_PROOF_KINDS, type WatchItem, type WatchProofKind } from '@/lib/admin/calibration-monitor';

// ⑥ Seen, not assumed. Observations are rows the run tables proved; pending
// expectations are the founder's. Since mig 147 an expectation may carry a
// PROOF — a fixed-kind predicate evaluated in SQL by the hourly evaluator
// (and on demand here) — and flips to SEEN only when the predicate holds,
// with the numbers that proved it kept as evidence. Items without a proof
// stay manual. These are the only writes this module makes.
const PARAM_HINT: Record<string, string> = {
  source: 'source literal, e.g. firms-recovery', feature: 'feature literal, e.g. nightlights_recovery', min_n: 'n', track: 'house | machine | creator',
  day: 'YYYY-MM-DD', nights: 'dates, comma-separated', alert_id: 'rule id, e.g. box-dark', min_voided: 'voided ≥',
};
const stamp = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');
const brief = (o: Record<string, unknown> | null | undefined) =>
  o ? Object.entries(o).map(([k, v]) => `${k} ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`).join(' · ') : '';

export function WatchList({ items, seen }: { items: WatchItem[]; seen: { at: string; text: string }[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [kind, setKind] = useState<'' | WatchProofKind>('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const post = (body: Record<string, unknown>, after?: (j: Record<string, unknown>) => void) =>
    start(async () => {
      setErr(null);
      const r = await fetch('/api/admin/calibration-monitor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        setErr((j.error as string) ?? `HTTP ${r.status}`);
        return;
      }
      after?.(j);
      router.refresh();
    });

  const proofFor = (it: WatchItem) => {
    const p = it.proof;
    if (!p) return null;
    const k = String(p.kind);
    const rest = Object.entries(p).filter(([key]) => key !== 'kind').map(([key, v]) => `${key}=${Array.isArray(v) ? v.join(',') : String(v)}`).join(' ');
    return `${k} ${rest}`;
  };

  return (
    <div className="card">
      <ul className="watch">
        {seen.map((s, i) => (
          <li key={`s${i}`}>
            <span className="t">{stamp(s.at)}</span>
            <span className="badge ok">SEEN</span> {s.text}
          </li>
        ))}
        {items.map((it) => (
          <li key={it.id} className={it.seen_at ? 'done' : ''}>
            <span className="t">{stamp(it.due_at)}</span>
            <span className={`badge ${it.seen_at ? 'ok' : 'info'}`} title={it.proof ? `proof: ${proofFor(it)}` : 'manual — no proof'}>{it.seen_at ? (it.proof ? 'PROVEN' : 'SEEN') : 'PENDING'}</span> {it.text}
            {it.proof && <span className="dim"> · proof {proofFor(it)}{it.checked_at ? ` · checked ${stamp(it.checked_at)} UTC` : ''}</span>}
            {it.evidence && <span className="dim"> · {it.seen_at ? 'evidence' : 'not yet'}: {brief(it.evidence)}</span>}
            {it.seen_at && <span className="dim"> · seen {stamp(it.seen_at)} UTC</span>}{' '}
            <button type="button" className="lnk" disabled={pending} onClick={() => post({ action: it.seen_at ? 'watch.unseen' : 'watch.seen', id: it.id })}>
              {it.seen_at ? 'reopen' : 'mark seen'}
            </button>{' '}
            <button type="button" className="lnk" disabled={pending} onClick={() => post({ action: 'watch.delete', id: it.id })}>
              delete
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="dim">No pending items — add what you expect to see next.</li>}
      </ul>
      <form
        className="addwatch"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const proof = kind ? { kind, ...params } : undefined;
          post({ action: 'watch.add', text: text.trim(), due_at: due ? `${due}T12:00:00Z` : null, proof }, () => {
            setText(''); setDue(''); setKind(''); setParams({});
          });
        }}
      >
        <label>
          <span className="sr">Expectation</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="What must a row prove next?" maxLength={500} />
        </label>
        <label>
          <span className="sr">Due</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label>
          <span className="sr">Proof kind</span>
          <select aria-label="Proof kind" value={kind} onChange={(e) => { setKind(e.target.value as '' | WatchProofKind); setParams({}); }}>
            <option value="">manual (no proof)</option>
            {(Object.keys(WATCH_PROOF_KINDS) as WatchProofKind[]).map((k) => (
              <option key={k} value={k}>proof: {WATCH_PROOF_KINDS[k].label}</option>
            ))}
          </select>
        </label>
        {kind && WATCH_PROOF_KINDS[kind].params.map((p) => (
          <label key={p}>
            <span className="sr">{p}</span>
            <input type={p === 'day' ? 'date' : p === 'min_n' || p === 'min_voided' ? 'number' : 'text'} value={params[p] ?? ''} onChange={(e) => setParams({ ...params, [p]: e.target.value })} placeholder={PARAM_HINT[p] ?? p} style={{ width: p === 'nights' ? 220 : 150 }} />
          </label>
        ))}
        <button type="submit" disabled={pending || !text.trim()}>Add</button>
        <button type="button" disabled={pending} onClick={() => post({ action: 'watch.check' }, (j) => { const r = j.result as { checked?: number; proven?: number } | undefined; setNote(r ? `checked ${r.checked} · proven ${r.proven}` : 'checked'); })}>
          Check proofs now
        </button>
        {note && <span className="dim">{note}</span>}
        {err && <span className="neg">{err}</span>}
      </form>
    </div>
  );
}
