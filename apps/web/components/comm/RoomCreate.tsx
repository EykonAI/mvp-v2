'use client';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

// Create a group room (COMM B2). On success, navigate to the new room.

export function RoomCreate() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/comm/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t }),
      });
      const json = (await res.json().catch(() => ({}))) as { room_id?: string };
      if (res.ok && json.room_id) {
        router.push(`/rooms/${json.room_id}`);
        return;
      }
      setErr('Could not create the room.');
    } catch {
      setErr('Network error — try again.');
    }
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 80))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void create();
          }
        }}
        placeholder="New room title…"
        style={inp}
      />
      <button onClick={() => void create()} disabled={busy || !title.trim()} style={{ ...btn, opacity: busy || !title.trim() ? 0.5 : 1 }}>
        {busy ? '…' : 'Create'}
      </button>
      {err && <span style={{ color: 'var(--red)', fontSize: 12 }}>{err}</span>}
    </div>
  );
}

const inp: CSSProperties = {
  flex: 1,
  background: 'var(--bg-void)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '9px 12px',
  color: 'var(--ink)',
  fontFamily: 'var(--f-body)',
  fontSize: 13.5,
};
const btn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  border: '1px solid var(--teal-dim)',
  borderRadius: 4,
  padding: '9px 16px',
  cursor: 'pointer',
};
