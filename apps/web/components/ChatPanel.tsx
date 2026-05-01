'use client';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { STARTER_PERSONAS } from '@/lib/intelligence-analyst/starter-queries';
import {
  COLD_START_SUGGESTIONS,
  type Suggestion,
} from '@/lib/intelligence-analyst/suggestions';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: number;
  // When true, this message is a frozen snapshot loaded from
  // /api/user_queries — not part of the live conversation thread.
  snapshot?: boolean;
  // For snapshot assistant messages, the source row id so the
  // Re-run button can hit /api/user_queries/[id]/rerun.
  query_id?: string;
}

interface HistoryEntry {
  id: string;
  query_text: string;
  response_text: string;
  tool_calls: Array<{ name: string; input: any; row_count: number | null }> | null;
  domain_tags: string[] | null;
  created_at: string;
  last_run_at: string;
  run_count: number;
  exported_at: string | null;
  starred: boolean;
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  content: `**Welcome to eYKON.ai Intelligence**\n\nI'm your geopolitical analyst. I have access to live data on aircraft, vessels, conflicts, energy infrastructure, and weather — plus posture scores, shadow-fleet leads, convergences, and the calibration ledger.\n\nAsk me anything.`,
};

type TabKey = 'history' | 'suggested' | null;

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Default the Suggested tab open on first load — preserves today's
  // UX where the curated list greets new users. Closes on first send.
  const [activeTab, setActiveTab] = useState<TabKey>('suggested');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('');
  // Suggestions are fetched once per session per §3.3 — refreshing
  // mid-session is "too noisy". Cold-start fallback rendered while
  // we wait for the first /api/suggestions response.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([...COLD_START_SUGGESTIONS]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/user_queries', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.entries ?? []);
    } catch {
      // Silent — history is a soft feature; failure shouldn't break chat.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Fetch personalised suggestions once on mount. No refresh on tab
  // toggles — §3.3 explicitly bans mid-session updates.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/suggestions', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data?.suggestions) return;
        setSuggestions(data.suggestions);
      })
      .catch(() => { /* keep cold-start fallback */ });
    return () => { cancelled = true; };
  }, []);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    // Collapse the tab strip once the user starts conversing — they're
    // engaged, the chat area should own the panel's vertical space.
    setActiveTab(null);

    try {
      // Snapshot bubbles are visual only — never sent back to /api/chat
      // (they would confuse the model into thinking the snapshot is
      // part of the live thread).
      const apiMessages = [
        ...messages.filter(m => m.id !== 'welcome' && !m.snapshot),
        userMsg,
      ].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content || data.error || 'No response',
        tool_calls: data.tool_calls,
        // Carry the persisted row id so the Export button can hit
        // /api/export/query/[id]. Null when auth is disabled.
        query_id: data.query_id ?? undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);
      // Refresh history so the just-submitted query appears in the
      // tab. Brief §3.2: list updates within 1 second of submission.
      void loadHistory();
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Error: ${err.message}. Check that ANTHROPIC_API_KEY is set.`,
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const openSnapshot = (entry: HistoryEntry) => {
    const tag = `snapshot-${entry.id}-${Date.now()}`;
    const userBubble: Message = {
      id: `${tag}-q`,
      role: 'user',
      content: entry.query_text,
      snapshot: true,
    };
    const assistantBubble: Message = {
      id: `${tag}-r`,
      role: 'assistant',
      content: entry.response_text,
      snapshot: true,
      query_id: entry.id,
      tool_calls: (entry.tool_calls ?? []).length || undefined,
    };
    setMessages(prev => [...prev, userBubble, assistantBubble]);
    setActiveTab(null);
  };

  const rerunSnapshot = async (queryId: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/user_queries/${queryId}/rerun`, { method: 'POST' });
      if (!res.ok) throw new Error(`Re-run failed: ${res.status}`);
      const data = await res.json();
      const freshMsg: Message = {
        id: `rerun-${queryId}-${Date.now()}`,
        role: 'assistant',
        content: data.content || data.error || 'No response',
        tool_calls: data.tool_calls,
      };
      setMessages(prev => [...prev, freshMsg]);
      void loadHistory();
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `rerun-err-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${err.message}.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const toggleTab = (key: TabKey) => {
    setActiveTab(prev => (prev === key ? null : key));
  };

  const toggleStar = useCallback(async (entryId: string, currentStarred: boolean) => {
    // Optimistic update — flip locally; server-side PATCH below.
    // On failure we re-load from server to roll back.
    setHistory(prev => prev.map(e => (e.id === entryId ? { ...e, starred: !currentStarred } : e)));
    try {
      const res = await fetch(`/api/user_queries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred: !currentStarred }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    } catch {
      // Roll back by re-fetching authoritative state.
      void loadHistory();
    }
  }, [loadHistory]);

  const filteredHistory = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return history;
    return history.filter(e => {
      if (e.query_text.toLowerCase().includes(q)) return true;
      const tags = e.domain_tags ?? [];
      for (const t of tags) {
        if (t.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [history, historyFilter]);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-panel)' }}>
      {/* Header */}
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--rule-soft)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="pulse-dot"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--teal)',
                boxShadow: '0 0 6px var(--teal)',
              }}
            />
            <span
              aria-label="eYKON Intelligence Analyst"
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--ink)',
                letterSpacing: '0.04em',
              }}
            >
              eYKON Intelligence Analyst
            </span>
          </div>
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.15em',
              color: 'var(--ink-faint)',
              textTransform: 'uppercase',
            }}
          >
            Sonnet 4.6
          </span>
        </div>
      </div>

      {/* Tab strip */}
      <div
        className="px-3 shrink-0 flex items-center gap-0"
        style={{ borderBottom: '1px solid var(--rule-soft)' }}
      >
        <TabButton
          label="Query History"
          active={activeTab === 'history'}
          onClick={() => toggleTab('history')}
        />
        <TabButton
          label="Suggested"
          active={activeTab === 'suggested'}
          onClick={() => toggleTab('suggested')}
        />
      </div>

      {/* Tab content */}
      {activeTab === 'history' && (
        <HistoryList
          entries={filteredHistory}
          totalCount={history.length}
          loading={historyLoading}
          filter={historyFilter}
          onFilterChange={setHistoryFilter}
          onPick={openSnapshot}
          onToggleStar={toggleStar}
          onPickStarter={text => {
            setInput(text);
            inputRef.current?.focus();
          }}
        />
      )}
      {activeTab === 'suggested' && (
        <SuggestedList
          suggestions={suggestions}
          onPick={text => send(text)}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-[90%] px-3 py-2 text-sm leading-relaxed"
              style={{
                background: msg.role === 'user' ? 'rgba(25, 208, 184, 0.14)' : 'var(--bg-raised)',
                color: 'var(--ink)',
                border: msg.role === 'user' ? '1px solid var(--teal-dim)' : '1px solid var(--rule)',
                borderRadius: 3,
                opacity: msg.snapshot ? 0.85 : 1,
              }}
            >
              {msg.snapshot && (
                <div
                  className="mb-1.5 flex items-center gap-1"
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 9,
                    color: 'var(--ink-faint)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  <span>◇</span>
                  <span>Snapshot</span>
                </div>
              )}
              <div className="chat-content whitespace-pre-wrap">{msg.content}</div>
              {msg.tool_calls != null && msg.tool_calls > 0 && !msg.snapshot && (
                <div
                  className="mt-1.5 flex items-center gap-1"
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 9.5,
                    color: 'var(--teal)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  <span>⚡</span>
                  <span>
                    {msg.tool_calls} tool iteration{msg.tool_calls > 1 ? 's' : ''}
                  </span>
                </div>
              )}
              {msg.role === 'assistant' && msg.query_id && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {msg.snapshot && (
                    <button
                      onClick={() => rerunSnapshot(msg.query_id!)}
                      disabled={loading}
                      className="px-2 py-1 text-xs transition-colors"
                      style={{
                        background: 'transparent',
                        color: 'var(--teal)',
                        border: '1px solid var(--teal-deep)',
                        borderRadius: 2,
                        fontFamily: 'var(--f-mono)',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.5 : 1,
                      }}
                    >
                      ↻ Re-run with fresh data
                    </button>
                  )}
                  <a
                    href={`/api/export/query/${msg.query_id}`}
                    className="px-2 py-1 text-xs transition-colors"
                    style={{
                      background: 'transparent',
                      color: 'var(--ink-dim)',
                      border: '1px solid var(--rule)',
                      borderRadius: 2,
                      fontFamily: 'var(--f-mono)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      textDecoration: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    ↓ Export PDF
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div
              className="px-4 py-3"
              style={{ background: 'var(--bg-raised)', border: '1px solid var(--rule)', borderRadius: 3 }}
            >
              <div className="flex gap-1">
                <div className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)' }} />
                <div className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)' }} />
                <div className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 shrink-0" style={{ borderTop: '1px solid var(--rule-soft)' }}>
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about any region, event, or entity..."
            rows={1}
            disabled={loading}
            className="flex-1 px-3 py-2 text-sm resize-none focus:outline-none"
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--rule)',
              color: 'var(--ink)',
              borderRadius: 2,
              fontFamily: 'var(--f-body)',
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="px-3 py-2 text-sm transition-colors"
            style={{
              background: 'var(--teal)',
              color: 'var(--bg-void)',
              border: '1px solid var(--teal-dim)',
              borderRadius: 2,
              fontWeight: 500,
              opacity: !input.trim() || loading ? 0.4 : 1,
              cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
            }}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 text-xs transition-colors"
      style={{
        background: 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-dim)',
        border: 'none',
        borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent',
        fontFamily: 'var(--f-mono)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        fontWeight: active ? 500 : 400,
      }}
    >
      {label}
    </button>
  );
}

function HistoryList({
  entries,
  totalCount,
  loading,
  filter,
  onFilterChange,
  onPick,
  onToggleStar,
  onPickStarter,
}: {
  entries: HistoryEntry[];
  totalCount: number;
  loading: boolean;
  filter: string;
  onFilterChange: (s: string) => void;
  onPick: (e: HistoryEntry) => void;
  onToggleStar: (id: string, currentStarred: boolean) => void;
  onPickStarter: (text: string) => void;
}) {
  // Show the curated empty state (§4.5) only when the user has NEVER
  // submitted a query — the search filter producing zero rows is a
  // different empty state and gets its own message.
  const showStarter = !loading && totalCount === 0;
  return (
    <div
      className="shrink-0 overflow-y-auto"
      style={{
        maxHeight: 320,
        borderBottom: '1px solid var(--rule-soft)',
      }}
    >
      {/* Search input (§4.2). Hidden in starter state — nothing to filter yet. */}
      {!showStarter && (
        <div
          className="px-3 pt-2 pb-1.5 sticky top-0"
          style={{ background: 'var(--bg-panel)' }}
        >
          <input
            type="text"
            value={filter}
            onChange={e => onFilterChange(e.target.value)}
            placeholder="Filter your queries…"
            className="w-full px-2 py-1 text-xs focus:outline-none"
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--rule)',
              color: 'var(--ink)',
              borderRadius: 2,
              fontFamily: 'var(--f-body)',
            }}
          />
        </div>
      )}

      {loading && (
        <div className="px-3 py-3">
          <div className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            Loading history…
          </div>
        </div>
      )}

      {showStarter && <StarterEmptyState onPick={onPickStarter} />}

      {!loading && !showStarter && entries.length === 0 && (
        <div className="px-3 py-3">
          <div className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            No queries match “{filter}”.
          </div>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <ul className="space-y-px px-1.5 pb-1.5">
          {entries.map(entry => (
            <li key={entry.id}>
              <HistoryEntryRow
                entry={entry}
                onPick={() => onPick(entry)}
                onToggleStar={() => onToggleStar(entry.id, entry.starred)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryEntryRow({
  entry,
  onPick,
  onToggleStar,
}: {
  entry: HistoryEntry;
  onPick: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div
      className="px-2 py-1.5 transition-colors flex gap-2 items-start"
      style={{
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 2,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-hover)';
        e.currentTarget.style.borderColor = 'var(--rule)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      <button
        onClick={onToggleStar}
        aria-label={entry.starred ? 'Unstar query' : 'Star query'}
        className="shrink-0 transition-colors"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 2,
          cursor: 'pointer',
          color: entry.starred ? 'var(--amber)' : 'var(--ink-ghost)',
          lineHeight: 0,
        }}
        onMouseEnter={e => {
          if (!entry.starred) e.currentTarget.style.color = 'var(--ink-dim)';
        }}
        onMouseLeave={e => {
          if (!entry.starred) e.currentTarget.style.color = 'var(--ink-ghost)';
        }}
      >
        <StarIcon filled={entry.starred} />
      </button>
      <button
        onClick={onPick}
        className="flex-1 min-w-0 text-left"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      >
        <div
          className="text-xs"
          style={{
            color: 'var(--ink)',
            fontFamily: 'var(--f-body)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {truncate(entry.query_text, 80)}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9,
              color: 'var(--ink-faint)',
              letterSpacing: '0.05em',
            }}
          >
            {relativeTime(entry.last_run_at)}
          </span>
          {primaryToolName(entry) && (
            <span
              className="px-1 py-px"
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 9,
                color: 'var(--teal)',
                background: 'var(--teal-glow)',
                border: '1px solid var(--teal-deep)',
                borderRadius: 2,
                letterSpacing: '0.04em',
              }}
            >
              {primaryToolName(entry)}
            </span>
          )}
          {(entry.domain_tags ?? []).map(tag => (
            <span
              key={tag}
              className="px-1 py-px"
              style={{
                fontFamily: 'var(--f-body)',
                fontSize: 9,
                color: 'var(--ink-dim)',
                background: 'var(--bg-raised)',
                border: '1px solid var(--rule)',
                borderRadius: 2,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </button>
    </div>
  );
}

function StarterEmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="px-3 py-3 space-y-3">
      <div
        className="text-xs"
        style={{ color: 'var(--ink-dim)', fontFamily: 'var(--f-body)' }}
      >
        Try one of these to get started.
      </div>
      {STARTER_PERSONAS.map(persona => (
        <div key={persona.id}>
          <div
            className="mb-1.5"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              color: 'var(--ink-faint)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {persona.label}
          </div>
          <div className="space-y-1">
            {persona.prompts.map((p, i) => (
              <button
                key={i}
                onClick={() => onPick(p)}
                className="block w-full text-left text-xs px-2 py-1.5 transition-colors"
                style={{
                  color: 'var(--ink-dim)',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--rule)',
                  borderRadius: 2,
                  fontFamily: 'var(--f-body)',
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function SuggestedList({
  suggestions,
  onPick,
}: {
  suggestions: readonly Suggestion[];
  onPick: (text: string) => void;
}) {
  return (
    <div
      className="shrink-0 overflow-y-auto"
      style={{
        maxHeight: 320,
        borderBottom: '1px solid var(--rule-soft)',
      }}
    >
      <div className="space-y-1.5 px-3 py-2">
        {suggestions.slice(0, 8).map((s, i) => {
          const cross = s.buckets.length >= 2;
          return (
            <button
              key={i}
              onClick={() => onPick(s.text)}
              className="block w-full text-left text-xs px-3 py-2 transition-colors"
              style={{
                color: 'var(--ink-dim)',
                background: 'var(--bg-raised)',
                border: '1px solid var(--rule)',
                borderRadius: 2,
                fontFamily: 'var(--f-body)',
                cursor: 'pointer',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1">{s.text}</span>
                {cross && (
                  <span
                    aria-label={`Cross-data: ${s.buckets.length} feeds`}
                    title={`Spans ${s.buckets.length} data feeds`}
                    className="shrink-0 px-1 py-px"
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 9,
                      color: 'var(--teal)',
                      background: 'var(--teal-glow)',
                      border: '1px solid var(--teal-deep)',
                      borderRadius: 2,
                      letterSpacing: '0.04em',
                    }}
                  >
                    × {s.buckets.length}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

function primaryToolName(entry: HistoryEntry): string | null {
  const calls = entry.tool_calls ?? [];
  if (calls.length === 0) return null;
  return calls[0]?.name ?? null;
}
