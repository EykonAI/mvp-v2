'use client';
import { useEffect, useState } from 'react';

// Settings card for the zero-config digest email. Mirrors the visual
// language of the other settings cards. Mounted for ALL tiers — the
// digest goes to every email-enabled user, so the off switch must be
// reachable by everyone (the email's unsubscribe link lands here too).
export function DigestPreferenceCard() {
  const [loaded, setLoaded] = useState(false);
  const [optedOut, setOptedOut] = useState(false);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/digest/preference', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return;
        setOptedOut(d.opted_out === true);
        setFrequency(d.frequency === 'weekly' ? 'weekly' : 'daily');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (saving || !loaded) return;
    const next = !optedOut ? true : false;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/digest/preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opted_out: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || `HTTP ${res.status}`);
      }
      setOptedOut(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const enabled = !optedOut;

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '24px 28px',
        marginBottom: 24,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          marginBottom: 4,
        }}
      >
        Intelligence digest
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginTop: 10 }}>
        <button
          type="button"
          onClick={toggle}
          disabled={!loaded || saving}
          aria-pressed={enabled}
          style={{
            width: 40,
            height: 22,
            borderRadius: 11,
            border: '1px solid var(--rule)',
            background: enabled ? '#19D0B8' : 'var(--bg-panel)',
            position: 'relative',
            cursor: !loaded || saving ? 'wait' : 'pointer',
            flexShrink: 0,
            padding: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: enabled ? 20 : 2,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: enabled ? '#0A1020' : 'var(--ink-dim)',
              transition: 'left 120ms ease',
            }}
          />
        </button>
        <div>
          <div style={{ color: 'var(--ink)', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
            {frequency === 'weekly' ? 'Weekly' : 'Daily'} digest email
          </div>
          <p style={{ color: 'var(--ink-faint)', fontSize: 12.5, lineHeight: 1.55, margin: 0 }}>
            A {frequency === 'weekly' ? 'weekly' : 'daily'} summary of anomalies, infrastructure
            incidents, conflict activity, and cross-domain convergences — tailored to your active
            persona, no rule setup needed. Quiet daily windows are skipped automatically.
          </p>
          {error ? (
            <p style={{ color: '#FF6B6B', fontSize: 12, margin: '6px 0 0' }}>{error}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
