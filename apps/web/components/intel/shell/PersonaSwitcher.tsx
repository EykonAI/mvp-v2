'use client';
import { useEffect, useState } from 'react';
import { usePersona, PERSONAS } from './PersonaContext';
import {
  readAdvancedFlag,
  subscribeAdvancedFlag,
} from '@/lib/intelligence-analyst/persona-visibility';
import { personaVisibility } from '@/lib/intelligence-analyst/personas';

/**
 * 2×4 persona chip grid. Filters to default-visible personas unless
 * the user has flipped the advanced toggle on /settings. The active
 * persona always shows as a chip even when advanced is off, so the
 * user is never confused about which persona is active.
 */
export default function PersonaSwitcher() {
  const { persona, setPersona } = usePersona();
  const [advancedEnabled, setAdvancedEnabled] = useState(false);

  useEffect(() => {
    setAdvancedEnabled(readAdvancedFlag());
    return subscribeAdvancedFlag(setAdvancedEnabled);
  }, []);

  const visible = PERSONAS.filter(
    p =>
      advancedEnabled ||
      personaVisibility(p.slug) === 'default' ||
      p.slug === persona,
  );

  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
      {visible.map(p => {
        const active = persona === p.slug;
        return (
          <button
            key={p.slug}
            data-persona={p.slug}
            onClick={() => setPersona(p.slug)}
            className="transition-colors"
            style={{
              padding: '6px 10px',
              fontFamily: 'var(--f-mono)',
              fontSize: 10.5,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              background: active ? 'var(--teal)' : 'var(--bg-panel)',
              color: active ? 'var(--bg-void)' : 'var(--ink-dim)',
              border: `1px solid ${active ? 'var(--teal-dim)' : 'var(--rule)'}`,
              borderRadius: 2,
              fontWeight: active ? 500 : 400,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
