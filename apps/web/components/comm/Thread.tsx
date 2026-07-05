'use client';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DmMessage } from '@/lib/comm/dm';
import { extractArtifactRefs } from '@/lib/comm/embeds';
import { ArtifactCard } from '@/components/comm/ArtifactCard';

// DM thread view (COMM B1). Renders the message list + composer and
// polls for new messages every 4s (Supabase Realtime is a later
// enhancement). Mine align right, theirs left.

export function Thread({
  roomId,
  me,
  initial,
  analystId,
}: {
  roomId: string;
  me: string;
  initial: DmMessage[];
  analystId?: string;
}) {
  const [messages, setMessages] = useState<DmMessage[]>(initial);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAtRef = useRef<string>(initial.length ? initial[initial.length - 1].created_at : '');

  useEffect(() => {
    if (messages.length) lastAtRef.current = messages[messages.length - 1].created_at;
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const after = lastAtRef.current;
        const res = await fetch(
          `/api/comm/dm/messages?room=${encodeURIComponent(roomId)}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
        );
        const json = (await res.json().catch(() => ({}))) as { messages?: DmMessage[] };
        if (active && Array.isArray(json.messages) && json.messages.length) {
          setMessages((prev) => dedupe([...prev, ...(json.messages as DmMessage[])]));
        }
      } catch {
        /* ignore poll errors */
      }
    };
    const t = window.setInterval(poll, 4000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, [roomId]);

  async function send() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/comm/dm/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomId, body: text }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: DmMessage };
      if (res.ok && json.message) {
        setMessages((prev) => dedupe([...prev, json.message as DmMessage]));
        setBody('');
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '64vh', border: '1px solid var(--rule)', borderRadius: 10, background: 'var(--bg-panel)' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 ? (
          <div style={{ color: 'var(--ink-faint)', fontSize: 12.5, textAlign: 'center', marginTop: 20 }}>No messages yet — say hello.</div>
        ) : (
          messages.map((m) => {
            const isAnalyst = !!analystId && m.author_id === analystId;
            const mine = !isAnalyst && m.author_id === me;
            return (
              <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: isAnalyst ? '92%' : '76%' }}>
                {isAnalyst && (
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 3 }}>
                    ⬡ eYKON Analyst
                  </div>
                )}
                <div
                  style={{
                    background: mine ? 'var(--teal-deep)' : 'var(--bg-raised)',
                    border: isAnalyst ? '1px solid var(--teal-dim)' : '1px solid transparent',
                    color: 'var(--ink)',
                    borderRadius: 10,
                    padding: '8px 12px',
                    fontSize: 13.5,
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {m.body}
                </div>
                {/* Artifact embeds (§4.2): /c and /q URLs in a message
                    render as cards. The raw URL stays in the body above,
                    so a failed preview degrades to a plain link. */}
                {extractArtifactRefs(m.body).map((ref) => (
                  <ArtifactCard key={`${ref.kind}:${ref.id}`} artifactRef={ref} />
                ))}
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--ink-faint)', marginTop: 3, textAlign: mine ? 'right' : 'left' }}>
                  {timeShort(m.created_at)}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <div style={{ borderTop: '1px solid var(--rule)', padding: 12, display: 'flex', gap: 8 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 4000))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message…"
          rows={1}
          style={{ flex: 1, resize: 'none', background: 'var(--bg-void)', border: '1px solid var(--rule)', borderRadius: 6, padding: '9px 12px', color: 'var(--ink)', fontFamily: 'var(--f-body)', fontSize: 13.5 }}
        />
        <button
          onClick={() => void send()}
          disabled={busy || !body.trim()}
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--bg-void)',
            background: 'var(--teal)',
            border: '1px solid var(--teal-dim)',
            borderRadius: 4,
            padding: '0 16px',
            cursor: busy || !body.trim() ? 'default' : 'pointer',
            opacity: busy || !body.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function dedupe(list: DmMessage[]): DmMessage[] {
  const seen = new Set<string>();
  const out: DmMessage[] = [];
  for (const m of list) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

function timeShort(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
}
