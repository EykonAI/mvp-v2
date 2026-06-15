'use client';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';

// Auth-aware follow control. Anonymous viewers get a "sign up to follow"
// CTA (the conversion path); signed-in viewers get an optimistic
// follow/unfollow toggle backed by /api/follow.

const baseBtn: CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  borderRadius: 3,
  padding: '9px 16px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
};
const primaryBtn: CSSProperties = {
  ...baseBtn,
  color: 'var(--bg-void)',
  background: 'var(--teal)',
  border: '1px solid var(--teal-dim)',
};
const followingBtn: CSSProperties = {
  ...baseBtn,
  color: 'var(--teal)',
  background: 'transparent',
  border: '1px solid var(--teal-dim)',
};

export function FollowButton({
  profileId,
  isAuthed,
  initialFollowing,
}: {
  profileId: string;
  isAuthed: boolean;
  initialFollowing: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  if (!isAuthed) {
    return (
      <Link href="/auth/signup" style={primaryBtn}>
        Sign up to follow →
      </Link>
    );
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !following;
    setFollowing(next);
    try {
      const res = next
        ? await fetch('/api/follow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId }),
          })
        : await fetch(`/api/follow?profileId=${encodeURIComponent(profileId)}`, { method: 'DELETE' });
      if (!res.ok) setFollowing(!next);
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={toggle} disabled={busy} style={{ ...(following ? followingBtn : primaryBtn), opacity: busy ? 0.6 : 1 }}>
      {following ? 'Following ✓' : '+ Follow'}
    </button>
  );
}
