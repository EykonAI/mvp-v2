'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { WatchItem } from '@/lib/admin/calibration-monitor';

// ⑥ Seen, not assumed. Observations are rows the run tables proved; pending
// expectations are the founder's, edited here — the only writes this module
// makes. An item is SEEN when the founder says a row proved it, never by
// inference from the page.
export function WatchList({ items, seen }: { items: WatchItem[]; seen: { at: string; text: string }[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const post = (body: Record<string, unknown>) =>
    start(async () => {
      setErr(null);
      const r = await fetch('/api/admin/calibration-monitor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setText('');
      setDue('');
      router.refresh();
    });

  const stamp = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');
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
            <span className={`badge ${it.seen_at ? 'ok' : 'info'}`}>{it.seen_at ? 'SEEN' : 'PENDING'}</span> {it.text}
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
          if (text.trim()) post({ action: 'watch.add', text: text.trim(), due_at: due ? `${due}T12:00:00Z` : null });
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
        <button type="submit" disabled={pending || !text.trim()}>
          Add
        </button>
        {err && <span className="neg">{err}</span>}
      </form>
    </div>
  );
}
