'use client';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// Profile "Message" action (COMM B1). Anonymous → sign-up CTA;
// signed-in → get-or-create the DM and navigate to the thread.

const chip: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.05em',
  padding: '6px 10px',
  borderRadius: 3,
  color: 'var(--ink-dim)',
  background: 'transparent',
  border: '1px solid var(--rule-soft)',
  cursor: 'pointer',
  textDecoration: 'none',
};

export function MessageButton({ profileId, isAuthed }: { profileId: string; isAuthed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!isAuthed) {
    return (
      <Link href="/auth/signup" style={chip} title="Sign up to message">
        Message
      </Link>
    );
  }

  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/comm/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: profileId }),
      });
      const json = (await res.json().catch(() => ({}))) as { room_id?: string };
      if (res.ok && json.room_id) {
        router.push(`/messages/${json.room_id}`);
        return;
      }
    } catch {
      /* ignore */
    }
    setBusy(false);
  }

  return (
    <button onClick={open} disabled={busy} style={{ ...chip, opacity: busy ? 0.6 : 1 }}>
      {busy ? '…' : 'Message'}
    </button>
  );
}
