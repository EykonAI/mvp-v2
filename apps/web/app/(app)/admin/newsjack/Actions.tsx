'use client';

import { useState } from 'react';

// Founder review actions for one newsjack draft. Posts to
// /api/admin/newsjack/[id]; refreshes the row's visible state on success.

// `publishTarget` is decided by the SERVER page (only it can see whether a
// publish path is configured for this channel) and names the destination.
// null = approve only marks the row; the founder posts by hand.
//
// The label must say what the click does: with the Discord webhook set,
// "Approve" IS a publish, and a button that publishes without saying so is
// the composer-badge gate all over again — state changing behind a label
// that stopped being true.
export interface RedditTarget {
  slug: string;
  url: string;
  mode: 'full' | 'title-only';
  flairRequired: string | null;
}

export default function NewsjackActions({ draftId, posts, channel, publishTarget, redditTargets }: { draftId: string; posts: string[]; channel: string; publishTarget: string | null; redditTargets?: RedditTarget[] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function act(action: 'approve' | 'reject') {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/newsjack/${draftId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = (await r.json()) as { error?: string; published?: boolean; mode?: string; url?: string; detail?: string };
      if (!r.ok) {
        setMsg(j.error ?? 'error');
      } else if (action === 'approve') {
        setDone('approved');
        if (j.published) setMsg(j.url ? `approved + posted: ${j.url}` : `approved + published (${j.mode ?? 'ok'})`);
        else setMsg(`approved — ${j.detail ?? 'post manually'}`);
      } else {
        setDone('rejected');
        setMsg('rejected');
      }
    } catch {
      setMsg('network error');
    }
    setBusy(false);
  }

  function copyThread() {
    void navigator.clipboard?.writeText(posts.join('\n\n'));
    setMsg('thread copied');
  }

  // Reddit is DRAFT-ONLY and this does not change that. The link opens
  // Reddit's own compose window with the draft already in it; the founder
  // posts as themselves. No API, no bot, and a human still at the gate.
  //
  // In 'title-only' mode the body was too long to carry in a URL safely, so it
  // goes to the clipboard instead. It is never truncated into the link — a
  // silently shortened post is one that ships without its limits paragraph or
  // its affiliation disclosure, which is the whole thing the artifact exists
  // to carry.
  function openReddit(t: RedditTarget) {
    if (t.mode === 'title-only') {
      void navigator.clipboard?.writeText(posts[1] ?? '');
      setMsg(`body copied — paste it into r/${t.slug}`);
    } else {
      setMsg(`compose window opened for r/${t.slug}${t.flairRequired ? ` — set flair: ${t.flairRequired}` : ''}`);
    }
  }

  const btn: React.CSSProperties = {
    fontFamily: 'var(--f-mono)',
    fontSize: 11,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid var(--rule)',
    background: 'transparent',
    color: 'var(--ink)',
    cursor: busy ? 'default' : 'pointer',
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
      <button style={{ ...btn, borderColor: 'var(--teal)', color: 'var(--teal)' }} disabled={busy || !!done} onClick={() => act('approve')}>
        {publishTarget ? `Approve + publish to ${publishTarget}` : 'Approve'}
      </button>
      <button style={{ ...btn, borderColor: 'var(--amber)', color: 'var(--amber)' }} disabled={busy || !!done} onClick={() => act('reject')}>
        Reject
      </button>
      <button style={btn} disabled={busy} onClick={copyThread}>
        Copy
      </button>
      {channel === 'reddit' && (redditTargets ?? []).map((t) => (
        <a
          key={t.slug}
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => openReddit(t)}
          // "Open" and not "Post": this hands you a compose window, it does not
          // publish. A button that says more than it does is the composer-badge
          // gate again.
          style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}
        >
          {t.mode === 'full' ? `Open in r/${t.slug}` : `Open r/${t.slug} + copy body`}
        </a>
      ))}
      {msg && <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{msg}</span>}
    </div>
  );
}
