'use client';
import { useState, useEffect } from 'react';

const DEFAULT_SUGGESTIONS = [
  'What happened in the Red Sea in the last 48 hours?',
  'Any AIS dark-ship events near the Strait of Hormuz?',
  'Show me current conflict activity in the Middle East',
  'Which energy infrastructure is near active conflict zones?',
  'Military aircraft activity summary for the Black Sea',
];

export default function SuggestedQueries() {
  const [suggestions, setSuggestions] = useState(DEFAULT_SUGGESTIONS);
  const [loading, setLoading] = useState(false);

  const refreshSuggestions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          watchlist_names: ['Red Sea', 'Strait of Hormuz', 'Black Sea'],
          viewport: { latitude: 25, longitude: 30 },
          recent_queries: [],
        }),
      });
      const data = await res.json();
      if (data.suggestions?.length) setSuggestions(data.suggestions);
    } catch {} finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-eykon-card border border-eykon-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Quick Queries</h2>
        <button
          onClick={refreshSuggestions}
          disabled={loading}
          className="text-[10px] text-eykon-teal hover:underline disabled:opacity-50"
        >
          {loading ? '...' : 'Refresh'}
        </button>
      </div>

      <div className="space-y-2">
        {suggestions.map((s, i) => (
          <button
            key={i}
            className="w-full text-left text-xs text-gray-300 bg-eykon-dark hover:bg-eykon-teal/10 border border-eykon-border/50 hover:border-eykon-teal/30 rounded-lg px-3 py-2 transition-all leading-relaxed"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="mt-4 pt-3 border-t border-eykon-border/50">
        <div className="text-[10px] text-eykon-muted uppercase tracking-wider mb-2">Quick Actions</div>
        <div className="space-y-1.5">
          <button className="w-full text-left text-xs text-eykon-teal bg-eykon-teal/5 hover:bg-eykon-teal/10 border border-eykon-teal/20 rounded-lg px-3 py-2 transition-all">
            📋 Generate Daily Briefing
          </button>
          <button className="w-full text-left text-xs text-gray-400 bg-eykon-dark hover:bg-eykon-card border border-eykon-border/50 rounded-lg px-3 py-2 transition-all">
            📍 Add Region to Watchlist
          </button>
          <button className="w-full text-left text-xs text-gray-400 bg-eykon-dark hover:bg-eykon-card border border-eykon-border/50 rounded-lg px-3 py-2 transition-all">
            🔔 Configure Alert Rules
          </button>
        </div>
      </div>
    </div>
  );
}
