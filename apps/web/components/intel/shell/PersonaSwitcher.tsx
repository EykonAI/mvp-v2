'use client';
import { usePersona, PERSONAS } from './PersonaContext';

/**
 * 2×4 persona chip grid. Changes the PersonaContext which is consumed
 * by feed cards, workspace heroes, and export templates. Feature 13/14/15/16/17 overlay.
 */
export default function PersonaSwitcher() {
  const { persona, setPersona } = usePersona();

  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
      {PERSONAS.map(p => {
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
