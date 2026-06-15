'use client';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

// Block / Report controls on a profile (COMM B3). Shown to signed-in
// non-owner viewers. Block prevents new DMs (either direction) and hides
// the blocked user's messages from the blocker; Report files a report
// for founder review.

const chip: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.05em',
  padding: '6px 10px',
  borderRadius: 3,
  background: 'transparent',
  border: '1px solid var(--rule-soft)',
  cursor: 'pointer',
};

export function ProfileModeration({ profileId, blocked }: { profileId: string; blocked: boolean }) {
  const router = useRouter();
  const [isBlocked, setIsBlocked] = useState(blocked);
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState(false);

  async function toggleBlock() {
    if (busy) return;
    setBusy(true);
    const next = !isBlocked;
    setIsBlocked(next);
    try {
      const res = next
        ? await fetch('/api/comm/block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: profileId }),
          })
        : await fetch(`/api/comm/block?target=${encodeURIComponent(profileId)}`, { method: 'DELETE' });
      if (!res.ok) setIsBlocked(!next);
      else router.refresh();
    } catch {
      setIsBlocked(!next);
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    if (reported) return;
    try {
      const res = await fetch('/api/comm/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'user', target_id: profileId, reason: 'Reported from profile' }),
      });
      if (res.ok) setReported(true);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <button onClick={toggleBlock} disabled={busy} style={{ ...chip, color: isBlocked ? 'var(--teal)' : 'var(--ink-faint)' }}>
        {isBlocked ? 'Unblock' : 'Block'}
      </button>
      <button onClick={report} disabled={reported} style={{ ...chip, color: 'var(--ink-faint)', opacity: reported ? 0.6 : 1 }}>
        {reported ? 'Reported ✓' : 'Report'}
      </button>
    </>
  );
}
