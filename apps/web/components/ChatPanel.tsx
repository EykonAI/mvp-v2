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
  content: `**Welcome to eYKON.ai Intelligence**\n\nI'm your geopolitical analyst. I have access to live data on aircraft, vessels, conflicts, energy infrastructure, and weather.\n\nAsk me anything — I'll query the data sources and synthesise an answer.`,
};

const SUGGESTIONS = [
  'What happened near the Red Sea in the last 48 hours?',
  'Show me military aircraft activity over the Black Sea',
  'Any AIS dark-ship events near the Strait of Hormuz?',
  'Which power plants are near active conflict zones?',
  'Briefing: current situation in the Taiwan Strait',
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(SUGGESTIONS);
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
      const apiMessages = [...messages.filter(m => m.id !== 'welcome'), userMsg]
        .map(m => ({ role: m.role, content: m.content }));

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
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${err.message}. Check that ANTHROPIC_API_KEY is set.`,
      }]);
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
    <div className="h-full flex flex-col bg-eykon-panel">
      {/* Header */}
      <div className="px-4 py-3 border-b border-eykon-border shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-eykon-teal pulse-dot" />
            <span className="text-sm font-semibold text-white">Intelligence Analyst</span>
          </div>
          <span className="text-[10px] text-eykon-muted">Claude Sonnet 4.5</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-eykon-teal/20 text-white rounded-br-sm'
                : 'bg-eykon-card text-gray-200 rounded-bl-sm border border-eykon-border/50'
            }`}>
              <div className="chat-content whitespace-pre-wrap">{msg.content}</div>
              {msg.tool_calls && msg.tool_calls > 0 && (
                <div className="mt-1.5 text-[10px] text-eykon-teal flex items-center gap-1">
                  <span>🔧</span>
                  <span>{msg.tool_calls} tool call{msg.tool_calls > 1 ? 's' : ''} executed</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-eykon-card rounded-xl px-4 py-3 border border-eykon-border/50">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-eykon-teal rounded-full typing-dot" />
                <div className="w-2 h-2 bg-eykon-teal rounded-full typing-dot" />
                <div className="w-2 h-2 bg-eykon-teal rounded-full typing-dot" />
              </div>
            </div>
          </div>
        )}

        {/* Suggestions (show when few messages) */}
        {messages.length <= 2 && !loading && (
          <div className="space-y-1.5 pt-2">
            <div className="text-[10px] text-eykon-muted uppercase tracking-wider">Suggested queries</div>
            {suggestions.slice(0, 4).map((s, i) => (
              <button
                key={i}
                onClick={() => send(s)}
                className="block w-full text-left text-xs text-gray-300 bg-eykon-card hover:bg-eykon-teal/10 border border-eykon-border/50 hover:border-eykon-teal/30 rounded-lg px-3 py-2 transition-all"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-eykon-border shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about any region, event, or entity..."
            rows={1}
            className="flex-1 bg-eykon-card border border-eykon-border rounded-lg px-3 py-2 text-sm text-white placeholder-eykon-muted resize-none focus:outline-none focus:border-eykon-teal/50 transition-colors"
            disabled={loading}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="px-3 py-2 bg-eykon-teal hover:bg-eykon-teal/80 disabled:bg-eykon-border disabled:text-eykon-muted text-white text-sm font-medium rounded-lg transition-colors"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
