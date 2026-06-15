'use client';
import { useState } from 'react';
import type { WallPost } from '@/lib/comm/profile';

// The profile wall — owner composes short posts; everyone can read. The
// composer and delete controls render only for the owner.

const MAX = 280;

export function Wall({ initialPosts, isOwner }: { initialPosts: WallPost[]; isOwner: boolean }) {
  const [posts, setPosts] = useState<WallPost[]>(initialPosts);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function post() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      const json = (await res.json().catch(() => ({}))) as { post?: WallPost; error?: string };
      if (!res.ok || !json.post) {
        setErr(json.error === 'rate_limited' ? 'Slow down a moment.' : 'Could not post — try again.');
      } else {
        setPosts((prev) => [json.post as WallPost, ...prev]);
        setBody('');
      }
    } catch {
      setErr('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    const prev = posts;
    setPosts((p) => p.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/wall?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) setPosts(prev);
    } catch {
      setPosts(prev);
    }
  }

  return (
    <div>
      {isOwner && (
        <div style={{ marginBottom: 18 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX))}
            placeholder="Share a take…"
            rows={2}
            style={{
              width: '100%',
              background: 'var(--bg-void)',
              border: '1px solid var(--rule)',
              borderRadius: 6,
              padding: '10px 12px',
              color: 'var(--ink)',
              fontFamily: 'var(--f-body)',
              fontSize: 13.5,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: err ? 'var(--red)' : 'var(--ink-faint)' }}>
              {err ?? `${body.length}/${MAX}`}
            </span>
            <button
              onClick={post}
              disabled={busy || !body.trim()}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--bg-void)',
                background: 'var(--teal)',
                border: '1px solid var(--teal-dim)',
                borderRadius: 3,
                padding: '7px 16px',
                cursor: busy || !body.trim() ? 'default' : 'pointer',
                opacity: busy || !body.trim() ? 0.5 : 1,
              }}
            >
              Post
            </button>
          </div>
        </div>
      )}

      {posts.length === 0 ? (
        <div
          style={{
            padding: '24px 20px',
            textAlign: 'center',
            border: '1px dashed var(--rule)',
            borderRadius: 6,
            color: 'var(--ink-faint)',
            fontSize: 12.5,
          }}
        >
          {isOwner ? 'Your wall is empty — share your first take above.' : 'No posts yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {posts.map((p) => (
            <div
              key={p.id}
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--rule-soft)',
                borderRadius: 6,
                padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{ color: 'var(--ink)', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {p.body}
                </span>
                {isOwner && (
                  <button
                    onClick={() => remove(p.id)}
                    title="Delete"
                    aria-label="Delete post"
                    style={{
                      flexShrink: 0,
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--ink-faint)',
                      cursor: 'pointer',
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 6 }}>
                {timeAgo(p.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return iso.slice(0, 10);
}
