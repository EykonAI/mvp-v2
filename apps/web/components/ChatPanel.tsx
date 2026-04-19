'use client';
import { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: number;
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  content: `**Welcome to eYKON.ai Intelligence**\n\nI'm your geopolitical analyst. I have access to live data on aircraft, vessels, conflicts, energy infrastructure, and weather — plus posture scores, shadow-fleet leads, convergences, and the calibration ledger.\n\nAsk me anything.`,
};

const SUGGESTIONS = [
  'Top 3 shadow-fleet leads with an AIS gap > 12 h in the past week',
  'What is the current posture score for the Red Sea?',
  'Any convergences in the last 6 hours?',
  'What was our 30-day Brier on conflict escalation?',
  'Run a Hormuz full closure scenario for 14 days',
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions] = useState(SUGGESTIONS);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const apiMessages = [...messages.filter(m => m.id !== 'welcome'), userMsg].map(m => ({
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
      };
      setMessages(prev => [...prev, assistantMsg]);
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
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--ink)',
                letterSpacing: '0.04em',
              }}
            >
              Intelligence Analyst
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
              }}
            >
              <div className="chat-content whitespace-pre-wrap">{msg.content}</div>
              {msg.tool_calls != null && msg.tool_calls > 0 && (
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

        {messages.length <= 2 && !loading && (
          <div className="space-y-1.5 pt-2">
            <div className="eyebrow">Suggested queries</div>
            {suggestions.slice(0, 4).map((s, i) => (
              <button
                key={i}
                onClick={() => send(s)}
                className="block w-full text-left text-xs px-3 py-2 transition-colors"
                style={{
                  color: 'var(--ink-dim)',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--rule)',
                  borderRadius: 2,
                  fontFamily: 'var(--f-body)',
                }}
              >
                {s}
              </button>
            ))}
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
