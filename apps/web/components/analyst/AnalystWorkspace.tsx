'use client';

// AI ANALYST v2 — the /analyst workspace (brief §6.1, MVP scope).
//
// Left rail: the user's sessions (pinned first, newest activity
// first) with new / rename / pin / delete. Centre: the persistent
// multi-turn thread, streamed over SSE with inline tool-use steps
// ("query_vessels — 214 rows"). The right context rail and projects
// arrive in v1; the layout leaves room for both.
//
// Tier gating (§9.6): the server page passes the EFFECTIVE tier.
// Citizens see the gate below — sessions/history are Member+.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  PERSONAS,
  DEFAULT_PERSONA,
  type PersonaId,
} from '@/lib/intelligence-analyst/personas';

interface SessionSummary {
  id: string;
  title: string;
  persona: string | null;
  model: string | null;
  origin: string;
  pinned: boolean;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
}

interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: number;
  streaming?: boolean;
}

interface ToolStep {
  name: string;
  row_count: number | null;
  done: boolean;
}

interface AnalystConfig {
  model: string;
  model_label: string;
  tier: string;
}

const MONO: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

function relTime(iso: string | null): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} m ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export default function AnalystWorkspace({ tier }: { tier: string }) {
  const gated = tier === 'citizen';

  const [config, setConfig] = useState<AnalystConfig | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [persona, setPersona] = useState<PersonaId>(DEFAULT_PERSONA);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/analyst/sessions', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      /* rail stays as-is; the thread surface reports real errors */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gated) return;
    fetch('/api/analyst/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setConfig(c))
      .catch(() => {});
    void loadSessions();
  }, [gated, loadSessions]);

  const openSession = useCallback(async (id: string) => {
    setActiveId(id);
    setThreadLoading(true);
    setToolSteps([]);
    try {
      const res = await fetch(`/api/analyst/sessions/${id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setThread(
        (data.messages ?? []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls.length : undefined,
        })),
      );
      const p = data.session?.persona;
      if (p && PERSONAS.some((x) => x.id === p)) setPersona(p);
    } catch {
      setThread([
        { id: 'err', role: 'system', content: 'Could not load this session. Try again.' },
      ]);
    } finally {
      setThreadLoading(false);
      setTimeout(scrollToBottom, 60);
    }
  }, [scrollToBottom]);

  const newSession = useCallback(() => {
    // Deferred creation: the row is created on first send so an
    // abandoned "New session" click never litters the rail.
    setActiveId(null);
    setThread([]);
    setToolSteps([]);
    inputRef.current?.focus();
  }, []);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (activeId) return activeId;
    const res = await fetch('/api/analyst/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, origin: 'workspace' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data.session?.id ?? null;
    if (id) {
      setActiveId(id);
      void loadSessions();
    }
    return id;
  }, [activeId, persona, loadSessions]);

  const send = useCallback(async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setBusy(true);
    setInput('');
    setToolSteps([]);

    const userMsg: ThreadMessage = { id: `u-${Date.now()}`, role: 'user', content: q };
    const pendingId = `a-${Date.now()}`;
    setThread((t) => [...t, userMsg, { id: pendingId, role: 'assistant', content: '', streaming: true }]);
    setTimeout(scrollToBottom, 40);

    try {
      const sid = await ensureSession();
      if (!sid) throw new Error('Could not create a session.');

      const res = await fetch(`/api/analyst/sessions/${sid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: q }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        let msg = err.error || `Request failed (${res.status}).`;
        if (res.status === 429 && err.upgrade_url) {
          msg += ` Upgrade: ${err.upgrade_url}`;
          if (err.pass_offer?.week_pass) msg += ` · ${err.pass_offer.week_pass.label}`;
        }
        setThread((t) =>
          t.map((m) => (m.id === pendingId ? { ...m, role: 'system', content: msg, streaming: false } : m)),
        );
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream.');
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';

      const handle = (payload: any) => {
        if (payload.type === 'text') {
          acc += payload.text;
          setThread((t) => t.map((m) => (m.id === pendingId ? { ...m, content: acc } : m)));
        } else if (payload.type === 'tool_start') {
          setToolSteps((s) => [...s, { name: payload.name, row_count: null, done: false }]);
        } else if (payload.type === 'tool_result') {
          setToolSteps((s) => {
            const idx = s.findIndex((x) => x.name === payload.name && !x.done);
            if (idx === -1) return s;
            const next = [...s];
            next[idx] = { ...next[idx], row_count: payload.row_count, done: true };
            return next;
          });
        } else if (payload.type === 'done') {
          setThread((t) =>
            t.map((m) =>
              m.id === pendingId
                ? {
                    ...m,
                    id: payload.message_id ?? m.id,
                    content: payload.content || acc,
                    tool_calls: payload.tool_calls,
                    streaming: false,
                  }
                : m,
            ),
          );
          void loadSessions(); // pick up auto-title + ordering
        } else if (payload.type === 'error') {
          setThread((t) =>
            t.map((m) =>
              m.id === pendingId
                ? { ...m, role: 'system', content: payload.error, streaming: false }
                : m,
            ),
          );
        }
        scrollToBottom();
      };

      // Parse SSE frames: "data: {json}\n\n"
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            handle(JSON.parse(line.slice(6)));
          } catch {
            /* skip malformed frame */
          }
        }
      }
    } catch (err: any) {
      setThread((t) =>
        t.map((m) =>
          m.id === pendingId
            ? { ...m, role: 'system', content: err?.message ?? 'Connection error.', streaming: false }
            : m,
        ),
      );
    } finally {
      setBusy(false);
      setTimeout(scrollToBottom, 60);
    }
  }, [input, busy, ensureSession, loadSessions, scrollToBottom]);

  async function togglePin(s: SessionSummary) {
    await fetch(`/api/analyst/sessions/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !s.pinned }),
    }).catch(() => {});
    void loadSessions();
  }

  async function commitRename(id: string) {
    const title = renameText.trim();
    setRenamingId(null);
    if (!title) return;
    await fetch(`/api/analyst/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => {});
    void loadSessions();
  }

  async function removeSession(id: string) {
    if (!window.confirm('Delete this session and its history? This cannot be undone.')) return;
    await fetch(`/api/analyst/sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    if (activeId === id) {
      setActiveId(null);
      setThread([]);
    }
    void loadSessions();
  }

  // ── Citizen gate (§9.6: continuity starts at Member) ──────────
  if (gated) {
    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '60px 24px', color: 'var(--ink)' }}>
        <div className="eyebrow" style={{ color: 'var(--teal)' }}>·· AI Analyst ··</div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 26, margin: '14px 0 10px' }}>
          The analyst workspace is a Member surface
        </h1>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.6, fontSize: 14 }}>
          Persistent sessions and history — conversations the analyst remembers — start on
          Member. Your docked analyst on the globe stays available with 5 queries a month.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          <Link
            href="/pricing?from=analyst_sessions"
            style={{
              ...MONO,
              fontSize: 11,
              padding: '9px 16px',
              background: 'var(--teal)',
              color: 'var(--bg-void)',
              borderRadius: 2,
              textDecoration: 'none',
            }}
          >
            See plans
          </Link>
          <Link
            href="/pricing?plan=week_pass"
            style={{
              ...MONO,
              fontSize: 11,
              padding: '9px 16px',
              border: '1px solid var(--rule-strong)',
              color: 'var(--ink-dim)',
              borderRadius: 2,
              textDecoration: 'none',
            }}
          >
            7 days of full Pro · $9
          </Link>
        </div>
      </div>
    );
  }

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 61px)', color: 'var(--ink)' }}>
      {/* ── Left rail — sessions ─────────────────────────────── */}
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          borderRight: '1px solid var(--rule-soft)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-panel)',
        }}
      >
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--rule-soft)' }}>
          <button
            onClick={newSession}
            style={{
              ...MONO,
              width: '100%',
              fontSize: 11,
              padding: '9px 0',
              background: 'var(--teal)',
              color: 'var(--bg-void)',
              border: 'none',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            + New session
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessionsLoading && (
            <div style={{ ...MONO, fontSize: 10, color: 'var(--ink-faint)', padding: 14 }}>
              Loading sessions…
            </div>
          )}
          {!sessionsLoading && sessions.length === 0 && (
            <div style={{ padding: 16, color: 'var(--ink-faint)', fontSize: 12.5, lineHeight: 1.55 }}>
              No sessions yet. Ask your first question — the analyst will remember the thread.
            </div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => renamingId !== s.id && openSession(s.id)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--rule-soft)',
                background: s.id === activeId ? 'var(--bg-raised)' : 'transparent',
                borderLeft: s.id === activeId ? '2px solid var(--teal)' : '2px solid transparent',
              }}
            >
              {renamingId === s.id ? (
                <input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(s.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={() => void commitRename(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    fontSize: 12.5,
                    background: 'var(--bg-void)',
                    color: 'var(--ink)',
                    border: '1px solid var(--teal)',
                    borderRadius: 2,
                    padding: '3px 6px',
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  {s.pinned && <span style={{ color: 'var(--teal)', fontSize: 10 }}>◆</span>}
                  <span
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.35,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {s.title}
                  </span>
                </div>
              )}
              <div
                style={{
                  ...MONO,
                  fontSize: 9,
                  color: 'var(--ink-faint)',
                  marginTop: 4,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span>{relTime(s.last_message_at ?? s.created_at)}</span>
                {s.origin === 'inline' && <span style={{ color: 'var(--teal-deep)' }}>· docked</span>}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
                  <button
                    title={s.pinned ? 'Unpin' : 'Pin'}
                    onClick={(e) => { e.stopPropagation(); void togglePin(s); }}
                    style={{ background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 10, padding: 0 }}
                  >
                    {s.pinned ? '◆' : '◇'}
                  </button>
                  <button
                    title="Rename"
                    onClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameText(s.title); }}
                    style={{ background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 10, padding: 0 }}
                  >
                    ✎
                  </button>
                  <button
                    title="Delete"
                    onClick={(e) => { e.stopPropagation(); void removeSession(s.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 10, padding: 0 }}
                  >
                    ×
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Centre — conversation ────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header: title + live model badge (reads the config — §8.7). */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 18px',
            borderBottom: '1px solid var(--rule-soft)',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--teal)' }} />
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 15, letterSpacing: '0.06em' }}>
            eYKON Intelligence Analyst
          </span>
          <span style={{ ...MONO, fontSize: 10, color: 'var(--ink-dim)' }}>
            {activeSession ? activeSession.title : 'New session'}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value as PersonaId)}
              disabled={!!activeId /* persona is fixed once a session starts */}
              style={{
                ...MONO,
                fontSize: 10,
                background: 'var(--bg-raised)',
                color: 'var(--ink-dim)',
                border: '1px solid var(--rule)',
                borderRadius: 2,
                padding: '4px 6px',
              }}
            >
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <span style={{ ...MONO, fontSize: 10, color: 'var(--teal)' }}>
              {config?.model_label ?? '—'}
            </span>
          </span>
        </div>

        {/* Thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {threadLoading && (
            <div style={{ ...MONO, fontSize: 10, color: 'var(--ink-faint)' }}>Loading thread…</div>
          )}
          {!threadLoading && thread.length === 0 && (
            <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center', color: 'var(--ink-dim)' }}>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 19, marginBottom: 10, color: 'var(--ink)' }}>
                Ask across every feed
              </div>
              <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                Live vessels, aircraft, conflicts, energy infrastructure, thermal anomalies,
                postures, convergences and the calibration ledger — one question away, with
                sources and row counts cited. This session will be remembered.
              </p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860, margin: '0 auto' }}>
            {thread.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '88%',
                    padding: '10px 14px',
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    borderRadius: 3,
                    background:
                      m.role === 'user'
                        ? 'rgba(25, 208, 184, 0.14)'
                        : m.role === 'system'
                        ? 'rgba(224, 118, 92, 0.12)'
                        : 'var(--bg-raised)',
                    border:
                      m.role === 'user'
                        ? '1px solid var(--teal-dim)'
                        : m.role === 'system'
                        ? '1px solid rgba(224, 118, 92, 0.45)'
                        : '1px solid var(--rule)',
                  }}
                >
                  <div className="chat-content whitespace-pre-wrap">
                    {m.content}
                    {m.streaming && <span style={{ color: 'var(--teal)' }}>▍</span>}
                  </div>
                  {m.tool_calls != null && m.tool_calls > 0 && (
                    <div style={{ ...MONO, fontSize: 9.5, color: 'var(--teal)', marginTop: 6 }}>
                      ⚡ {m.tool_calls} tool iteration{m.tool_calls > 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {/* Live tool steps for the in-flight turn (§8.2). */}
            {busy && toolSteps.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {toolSteps.map((t, i) => (
                  <span
                    key={`${t.name}-${i}`}
                    style={{
                      ...MONO,
                      fontSize: 9.5,
                      padding: '3px 8px',
                      borderRadius: 2,
                      border: '1px solid var(--rule)',
                      color: t.done ? 'var(--teal)' : 'var(--ink-dim)',
                      background: 'var(--bg-panel)',
                    }}
                  >
                    {t.done
                      ? `${t.name}${t.row_count != null ? ` — ${t.row_count} rows` : ' — done'}`
                      : `${t.name}…`}
                  </span>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div style={{ borderTop: '1px solid var(--rule-soft)', padding: '12px 22px 16px' }}>
          <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="Ask the analyst — Enter to send, Shift+Enter for a new line"
              disabled={busy}
              style={{
                flex: 1,
                resize: 'none',
                fontSize: 13.5,
                lineHeight: 1.5,
                padding: '10px 12px',
                background: 'var(--bg-raised)',
                color: 'var(--ink)',
                border: '1px solid var(--rule)',
                borderRadius: 3,
                outline: 'none',
              }}
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              style={{
                ...MONO,
                fontSize: 11,
                padding: '11px 18px',
                background: busy || !input.trim() ? 'var(--bg-raised)' : 'var(--teal)',
                color: busy || !input.trim() ? 'var(--ink-faint)' : 'var(--bg-void)',
                border: 'none',
                borderRadius: 2,
                cursor: busy || !input.trim() ? 'default' : 'pointer',
              }}
            >
              {busy ? 'Working…' : 'Send'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
