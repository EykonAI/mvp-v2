'use client';

import { PERSONAS, type PersonaId } from '@/lib/closing/personas';

/**
 * Step 1 — the only question that matters first (brief v1.4 §4.0).
 *
 * A micro-commitment that costs the visitor one click and buys the page
 * a tailored pitch. The Kuwait receipt sits directly below on the same
 * step: proof does the persuading while the question qualifies, so the
 * step is never a toll gate in front of the argument.
 */
export function PersonaGrid({
  selected,
  onSelect,
}: {
  selected: PersonaId | null;
  onSelect: (id: PersonaId) => void;
}) {
  return (
    <div className="cs-grid" role="radiogroup" aria-label="What describes you best?">
      {PERSONAS.map((p) => {
        const on = selected === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={on ? 'cs-pcardx cs-sel' : 'cs-pcardx'}
            onClick={() => onSelect(p.id)}
          >
            <span className="cs-tick" aria-hidden="true" />
            <span className="cs-k">{p.label}</span>
            <span className="cs-d">{p.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}
