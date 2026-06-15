'use client';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

export function JoinRoomButton({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function join() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/comm/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomId }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
    } catch {
      /* ignore */
    }
    setBusy(false);
  }

  return (
    <button onClick={join} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>
      {busy ? 'Joining…' : 'Join room'}
    </button>
  );
}

const btn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 12,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  border: '1px solid var(--teal-dim)',
  borderRadius: 4,
  padding: '10px 20px',
  cursor: 'pointer',
};
