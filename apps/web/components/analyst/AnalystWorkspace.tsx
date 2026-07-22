'use client';

// AI ANALYST v2 — the /analyst workspace (brief §6.1).
//
// MVP: session rail + persistent streamed thread with live tool steps.
// v1 adds the Pro+ leverage layer (§9.6): projects (switcher + custom
// instructions), the Deep Analysis toggle (Opus 4.8 per session),
// save-as-insight, move-session-to-project, and session PDF export.
//
// Tier gating: the server page passes the EFFECTIVE tier. Citizens see
// the gate (sessions/history are Member+). The v1 leverage controls
// render only for Pro+ (isPro); the server APIs enforce it regardless.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PERSONAS, DEFAULT_PERSONA, type PersonaId } from '@/lib/intelligence-analyst/personas';

interface SessionSummary {
  id: string;
  title: string;
  persona: string | null;
  model: string | null;
  origin: string;
  project_id: string | null;
  pinned: boolean;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  instructions: string | null;
  pinned: boolean;
}

interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: number;
  streaming?: boolean;
  saved?: boolean;
}

interface ToolStep {
  name: string;
  row_count: number | null;
  done: boolean;
}

interface AnalystConfig {
  model: string;
  model_label: string;
  deep_model: string;
  deep_model_label: string;
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
  const isPro = config ? ['pro', 'desk', 'enterprise'].includes(config.tier) : false;

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectFilter, setProjectFilter] = useState<string | null>(null); // null = All
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectInstr, setNewProjectInstr] = useState('');

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [persona, setPersona] = useState<PersonaId>(DEFAULT_PERSONA);
  const [deepOn, setDeepOn] = useState(false);
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
      /* rail stays as-is */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/analyst/projects', { cache: 'no-store' });
      if (!res.ok) return; // 403 for non-Pro — projects stay empty
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (gated) return;
    fetch('/api/analyst/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c) return;
        setConfig(c);
        if (['pro', 'desk', 'enterprise'].includes(c.tier)) void loadProjects();
      })
      .catch(() => {});
    void loadSessions();
  }, [gated, loadSessions, loadProjects]);

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
      setActiveModel(data.session?.model ?? null);
      setDeepOn(!!config && data.session?.model === config.deep_model);
    } catch {
      setThread([{ id: 'err', role: 'system', content: 'Could not load this session. Try again.' }]);
    } finally {
      setThreadLoading(false);
      setTimeout(scrollToBottom, 60);
    }
  }, [config, scrollToBottom]);

  const newSession = useCallback(() => {
    setActiveId(null);
    setActiveModel(null);
    setThread([]);
    setToolSteps([]);
    setDeepOn(false);
    inputRef.current?.focus();
  }, []);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (activeId) return activeId;
    const body: Record<string, unknown> = { persona, origin: 'workspace' };
    if (deepOn && config?.deep_model) body.model = config.deep_model;
    const res = await fetch('/api/analyst/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data.session?.id ?? null;
    if (id) {
      setActiveId(id);
      setActiveModel(data.session?.model ?? null);
      // File under the active project filter if one is selected.
      if (projectFilter) {
        await fetch(`/api/analyst/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectFilter }),
        }).catch(() => {});
      }
      void loadSessions();
    }
    return id;
  }, [activeId, persona, deepOn, config, projectFilter, loadSessions]);

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
        if (res.status === 429 && err.pass_offer?.week_pass) msg += ` · ${err.pass_offer.week_pass.label}`;
        setThread((t) => t.map((m) => (m.id === pendingId ? { ...m, role: 'system', content: msg, streaming: false } : m)));
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
                ? { ...m, id: payload.message_id ?? m.id, content: payload.content || acc, tool_calls: payload.tool_calls, streaming: false }
                : m,
            ),
          );
          void loadSessions();
        } else if (payload.type === 'error') {
          setThread((t) => t.map((m) => (m.id === pendingId ? { ...m, role: 'system', content: payload.error, streaming: false } : m)));
        }
        scrollToBottom();
      };

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
      setThread((t) => t.map((m) => (m.id === pendingId ? { ...m, role: 'system', content: err?.message ?? 'Connection error.', streaming: false } : m)));
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
    if (activeId === id) { setActiveId(null); setThread([]); }
    void loadSessions();
  }

  // ── v1 handlers ────────────────────────────────────────────────
  async function toggleDeep() {
    if (!isPro || !config) return;
    const next = !deepOn;
    setDeepOn(next);
    if (activeId) {
      const res = await fetch(`/api/analyst/sessions/${activeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: next ? config.deep_model : null }),
      }).catch(() => null);
      if (res && res.ok) setActiveModel(next ? config.deep_model : null);
      else setDeepOn(!next); // roll back on failure
    }
    // No active session yet: ensureSession applies deepOn at create time.
  }

  async function assignProject(pid: string | null) {
    if (!activeId) return;
    await fetch(`/api/analyst/sessions/${activeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: pid }),
    }).catch(() => {});
    void loadSessions();
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    const res = await fetch('/api/analyst/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, instructions: newProjectInstr.trim() || undefined }),
    }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      setNewProjectOpen(false);
      setNewProjectName('');
      setNewProjectInstr('');
      await loadProjects();
      if (data.project?.id) setProjectFilter(data.project.id);
    }
  }

  async function saveInsight(m: ThreadMessage) {
    if (!isPro || !activeId || m.role !== 'assistant') return;
    const title = (m.content.split('\n').find((l) => l.trim()) || 'Insight').replace(/^#+\s*/, '').slice(0, 120);
    const res = await fetch('/api/analyst/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: activeId, message_id: m.id.startsWith('a-') ? undefined : m.id, title, body: m.content }),
    }).catch(() => null);
    if (res && res.ok) {
      setThread((t) => t.map((x) => (x.id === m.id ? { ...x, saved: true } : x)));
    }
  }

  function exportSession() {
    if (!activeId) return;
    window.open(`/api/analyst/sessions/${activeId}/export`, '_blank');
  }

  // ── Citizen gate ───────────────────────────────────────────────
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
          <Link href="/pricing?from=analyst_sessions" style={{ ...MONO, fontSize: 11, padding: '9px 16px', background: 'var(--teal)', color: 'var(--bg-void)', borderRadius: 2, textDecoration: 'none' }}>See plans</Link>
          <Link href="/pricing?plan=week_pass" style={{ ...MONO, fontSize: 11, padding: '9px 16px', border: '1px solid var(--rule-strong)', color: 'var(--ink-dim)', borderRadius: 2, textDecoration: 'none' }}>7 days of full Pro · $9</Link>
        </div>
      </div>
    );
  }

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const visibleSessions = projectFilter ? sessions.filter((s) => s.project_id === projectFilter) : sessions;
  const modelBadge = deepOn ? config?.deep_model_label ?? 'Opus 4.8' : config?.model_label ?? '—';

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 61px)', color: 'var(--ink)' }}>
      {/* ── Left rail ─────────────────────────────────────────── */}
      <aside style={{ width: 288, flexShrink: 0, borderRight: '1px solid var(--rule-soft)', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)' }}>
        {/* Project switcher (Pro+) */}
        {isPro && (
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--rule-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ ...MONO, fontSize: 9, color: 'var(--ink-faint)' }}>Projects</span>
              <button onClick={() => setNewProjectOpen((v) => !v)} title="New project"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--teal)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>+</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              <ProjectChip label="All" active={projectFilter === null} onClick={() => setProjectFilter(null)} />
              {projects.map((p) => (
                <ProjectChip key={p.id} label={p.name} active={projectFilter === p.id} onClick={() => setProjectFilter(p.id)} />
              ))}
            </div>
            {newProjectOpen && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Project name (e.g. Red Sea shipping)"
                  style={inputStyle} />
                <textarea value={newProjectInstr} onChange={(e) => setNewProjectInstr(e.target.value)} rows={2}
                  placeholder="Custom instructions for every session in this project (optional)" style={{ ...inputStyle, resize: 'none' }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => void createProject()} style={{ ...MONO, fontSize: 10, padding: '5px 10px', background: 'var(--teal)', color: 'var(--bg-void)', border: 'none', borderRadius: 2, cursor: 'pointer' }}>Create</button>
                  <button onClick={() => setNewProjectOpen(false)} style={{ ...MONO, fontSize: 10, padding: '5px 10px', background: 'transparent', color: 'var(--ink-faint)', border: '1px solid var(--rule)', borderRadius: 2, cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid var(--rule-soft)' }}>
          <button onClick={newSession} style={{ ...MONO, width: '100%', fontSize: 11, padding: '9px 0', background: 'var(--teal)', color: 'var(--bg-void)', border: 'none', borderRadius: 2, cursor: 'pointer' }}>
            + New session
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessionsLoading && <div style={{ ...MONO, fontSize: 10, color: 'var(--ink-faint)', padding: 14 }}>Loading sessions…</div>}
          {!sessionsLoading && visibleSessions.length === 0 && (
            <div style={{ padding: 16, color: 'var(--ink-faint)', fontSize: 12.5, lineHeight: 1.55 }}>
              {projectFilter ? 'No sessions in this project yet.' : 'No sessions yet. Ask your first question — the analyst will remember the thread.'}
            </div>
          )}
          {visibleSessions.map((s) => (
            <div key={s.id} onClick={() => renamingId !== s.id && openSession(s.id)}
              style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--rule-soft)', background: s.id === activeId ? 'var(--bg-raised)' : 'transparent', borderLeft: s.id === activeId ? '2px solid var(--teal)' : '2px solid transparent' }}>
              {renamingId === s.id ? (
                <input autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void commitRename(s.id); if (e.key === 'Escape') setRenamingId(null); }}
                  onBlur={() => void commitRename(s.id)} onClick={(e) => e.stopPropagation()} style={inputStyle} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  {s.pinned && <span style={{ color: 'var(--teal)', fontSize: 10 }}>◆</span>}
                  <span style={{ fontSize: 12.5, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.title}</span>
                </div>
              )}
              <div style={{ ...MONO, fontSize: 9, color: 'var(--ink-faint)', marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>{relTime(s.last_message_at ?? s.created_at)}</span>
                {s.origin === 'inline' && <span style={{ color: 'var(--teal-deep)' }}>· docked</span>}
                {s.model && config && s.model === config.deep_model && <span style={{ color: 'var(--accent, #E0765C)' }}>· deep</span>}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
                  <button title={s.pinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); void togglePin(s); }} style={iconBtn}>{s.pinned ? '◆' : '◇'}</button>
                  <button title="Rename" onClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameText(s.title); }} style={iconBtn}>✎</button>
                  <button title="Delete" onClick={(e) => { e.stopPropagation(); void removeSession(s.id); }} style={iconBtn}>×</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Centre — conversation ─────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--rule-soft)', flexWrap: 'wrap' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--teal)' }} />
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 15, letterSpacing: '0.06em' }}>eYKON Intelligence Analyst</span>
          <span style={{ ...MONO, fontSize: 10, color: 'var(--ink-dim)' }}>{activeSession ? activeSession.title : 'New session'}</span>

          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Move-to-project (Pro+, active session) */}
            {isPro && activeId && projects.length > 0 && (
              <select value={activeSession?.project_id ?? ''} onChange={(e) => void assignProject(e.target.value || null)}
                title="File this session under a project" style={selectStyle}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <select value={persona} onChange={(e) => setPersona(e.target.value as PersonaId)} disabled={!!activeId} style={selectStyle}>
              {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {/* Deep Analysis toggle (Pro+) */}
            {isPro && (
              <button onClick={() => void toggleDeep()} title="Deep Analysis runs this session on Opus 4.8"
                style={{ ...MONO, fontSize: 9.5, padding: '4px 8px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${deepOn ? 'var(--teal)' : 'var(--rule)'}`, background: deepOn ? 'var(--teal)' : 'transparent', color: deepOn ? 'var(--bg-void)' : 'var(--ink-dim)' }}>
                Deep {deepOn ? 'on' : 'off'}
              </button>
            )}
            {/* Export (Pro+, active session) */}
            {isPro && activeId && (
              <button onClick={exportSession} title="Export this session as a PDF" style={{ ...MONO, fontSize: 9.5, padding: '4px 8px', borderRadius: 2, cursor: 'pointer', border: '1px solid var(--rule)', background: 'transparent', color: 'var(--ink-dim)' }}>
                Export ↓
              </button>
            )}
            <span style={{ ...MONO, fontSize: 10, color: 'var(--teal)' }}>{modelBadge}</span>
          </span>
        </div>

        {/* Thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {threadLoading && <div style={{ ...MONO, fontSize: 10, color: 'var(--ink-faint)' }}>Loading thread…</div>}
          {!threadLoading && thread.length === 0 && (
            <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center', color: 'var(--ink-dim)' }}>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 19, marginBottom: 10, color: 'var(--ink)' }}>Ask across every feed</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                Live vessels, aircraft, conflicts, energy infrastructure, thermal anomalies, postures,
                convergences and the calibration ledger — one question away, with sources and row counts cited.
                This session will be remembered.
              </p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860, margin: '0 auto' }}>
            {thread.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '88%', padding: '10px 14px', fontSize: 13.5, lineHeight: 1.6, borderRadius: 3,
                  background: m.role === 'user' ? 'rgba(25, 208, 184, 0.14)' : m.role === 'system' ? 'rgba(224, 118, 92, 0.12)' : 'var(--bg-raised)',
                  border: m.role === 'user' ? '1px solid var(--teal-dim)' : m.role === 'system' ? '1px solid rgba(224, 118, 92, 0.45)' : '1px solid var(--rule)' }}>
                  <div className="chat-content whitespace-pre-wrap">
                    {m.content}
                    {m.streaming && <span style={{ color: 'var(--teal)' }}>▍</span>}
                  </div>
                  {m.tool_calls != null && m.tool_calls > 0 && (
                    <div style={{ ...MONO, fontSize: 9.5, color: 'var(--teal)', marginTop: 6 }}>⚡ {m.tool_calls} tool iteration{m.tool_calls > 1 ? 's' : ''}</div>
                  )}
                  {/* Save-as-insight (Pro+, completed assistant turns) */}
                  {isPro && m.role === 'assistant' && !m.streaming && m.content.trim() && (
                    <div style={{ marginTop: 6 }}>
                      <button onClick={() => void saveInsight(m)} disabled={m.saved}
                        style={{ ...MONO, fontSize: 9, padding: '2px 7px', borderRadius: 2, cursor: m.saved ? 'default' : 'pointer', border: '1px solid var(--rule)', background: 'transparent', color: m.saved ? 'var(--teal)' : 'var(--ink-faint)' }}>
                        {m.saved ? '✓ saved' : '+ save insight'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && toolSteps.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {toolSteps.map((t, i) => (
                  <span key={`${t.name}-${i}`} style={{ ...MONO, fontSize: 9.5, padding: '3px 8px', borderRadius: 2, border: '1px solid var(--rule)', color: t.done ? 'var(--teal)' : 'var(--ink-dim)', background: 'var(--bg-panel)' }}>
                    {t.done ? `${t.name}${t.row_count != null ? ` — ${t.row_count} rows` : ' — done'}` : `${t.name}…`}
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
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              rows={2} placeholder="Ask the analyst — Enter to send, Shift+Enter for a new line" disabled={busy}
              style={{ flex: 1, resize: 'none', fontSize: 13.5, lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg-raised)', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 3, outline: 'none' }} />
            <button onClick={() => void send()} disabled={busy || !input.trim()}
              style={{ ...MONO, fontSize: 11, padding: '11px 18px', background: busy || !input.trim() ? 'var(--bg-raised)' : 'var(--teal)', color: busy || !input.trim() ? 'var(--ink-faint)' : 'var(--bg-void)', border: 'none', borderRadius: 2, cursor: busy || !input.trim() ? 'default' : 'pointer' }}>
              {busy ? 'Working…' : 'Send'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

const iconBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 10, padding: 0 };
const inputStyle: React.CSSProperties = { width: '100%', fontSize: 12, background: 'var(--bg-void)', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 2, padding: '5px 7px', outline: 'none' };
const selectStyle: React.CSSProperties = { ...MONO, fontSize: 10, background: 'var(--bg-raised)', color: 'var(--ink-dim)', border: '1px solid var(--rule)', borderRadius: 2, padding: '4px 6px' };

function ProjectChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...MONO, fontSize: 9, padding: '3px 8px', borderRadius: 2, cursor: 'pointer', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: `1px solid ${active ? 'var(--teal)' : 'var(--rule)'}`, background: active ? 'var(--teal)' : 'transparent', color: active ? 'var(--bg-void)' : 'var(--ink-dim)' }}>
      {label}
    </button>
  );
}
