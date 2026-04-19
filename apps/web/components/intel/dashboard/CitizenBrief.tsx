'use client';
import { useEffect, useState } from 'react';

/**
 * Feature 14 Citizen Brief — 300-word plain-language briefing.
 * Calls /api/intel/briefing?persona=citizen on mount. Mandatory
 * source list + "what I'm unsure about" paragraph.
 */
export default function CitizenBrief() {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/intel/briefing?persona=citizen', { method: 'POST' })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        setText(j.briefing);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <p
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          padding: 16,
        }}
      >
        Composing brief …
      </p>
    );
  }

  if (error) {
    return (
      <p
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 12,
          color: 'var(--ink-dim)',
          padding: 16,
        }}
      >
        Briefing unavailable: {error}. Set ANTHROPIC_API_KEY and ensure Supabase is reachable.
      </p>
    );
  }

  return (
    <article
      style={{
        padding: '16px 18px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule-soft)',
        borderLeft: '2px solid var(--teal)',
      }}
    >
      <div
        className="chat-content"
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--ink)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </article>
  );
}
