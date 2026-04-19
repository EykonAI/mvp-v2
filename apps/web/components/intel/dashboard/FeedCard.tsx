'use client';
import { usePersona } from '@/components/intel/shell/PersonaContext';

export interface FeedItem {
  id: string;
  headline: string;
  region?: string;
  sigma?: number;                 // contextual-baseline σ score
  entity?: string;
  when_hour_of_week?: string;
  domain: 'maritime' | 'air_traffic' | 'conflict' | 'energy' | 'cross';
  sources: Array<{ provider: string; fetched_at: string; transform?: string; licence?: string }>;
  narrative: string;
  market_note?: string;           // for day-trader / commodities
  plain_summary?: string;         // for citizen
  story_potential?: number;       // for journalist (0..1)
  asset_exposure?: string[];      // for corporate
}

/**
 * Enriched intelligence feed card. Every card carries:
 *  - contextual-baseline σ score (Feature 20)
 *  - provenance-expand chip (Feature 23)
 *  - persona-appropriate footer (Feature 13/14/15/17)
 *  - N-Hop expander button placeholder (Feature 12)
 */
export default function FeedCard({ item }: { item: FeedItem }) {
  const { persona } = usePersona();
  return (
    <article
      style={{
        padding: 12,
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule-soft)',
        borderLeft: `2px solid ${domainColour(item.domain)}`,
      }}
    >
      <header className="flex items-baseline justify-between" style={{ gap: 12 }}>
        <h4
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: '0.02em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          {item.headline}
        </h4>
        {typeof item.sigma === 'number' && (
          <span
            className="num-lg"
            style={{
              fontSize: 11,
              color: Math.abs(item.sigma) >= 3 ? 'var(--red)' : 'var(--amber)',
              whiteSpace: 'nowrap',
            }}
          >
            {item.sigma.toFixed(1)}σ{item.entity && item.when_hour_of_week
              ? ` · ${item.entity} @ ${item.when_hour_of_week}`
              : ''}
          </span>
        )}
      </header>

      <p style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.5, margin: '6px 0' }}>
        {item.narrative}
      </p>

      {/* Persona footer */}
      {persona === 'day-trader' && item.market_note && (
        <PersonaFooter label="Market note" body={item.market_note} />
      )}
      {persona === 'commodities' && item.market_note && (
        <PersonaFooter label="Commodities implication" body={item.market_note} />
      )}
      {persona === 'citizen' && item.plain_summary && (
        <PersonaFooter label="What this means" body={item.plain_summary} />
      )}
      {persona === 'journalist' && typeof item.story_potential === 'number' && (
        <PersonaFooter
          label="Story potential"
          body={`${Math.round(item.story_potential * 100)}% — lead-worthy signals: ${item.sources.slice(0, 2).map(s => s.provider).join(', ')}`}
        />
      )}
      {persona === 'corporate' && item.asset_exposure && item.asset_exposure.length > 0 && (
        <PersonaFooter label="Asset exposure" body={item.asset_exposure.join(' · ')} />
      )}

      {/* Footer row: provenance + actions */}
      <footer className="flex items-center justify-between" style={{ marginTop: 10, gap: 8 }}>
        <details>
          <summary
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 9.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              cursor: 'pointer',
              listStyle: 'none',
            }}
          >
            Provenance ▸
          </summary>
          <ul
            style={{
              listStyle: 'none',
              padding: '6px 0 0 0',
              margin: 0,
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              color: 'var(--ink-dim)',
            }}
          >
            {item.sources.map((s, i) => (
              <li key={i}>
                {s.provider} · {new Date(s.fetched_at).toLocaleString()}
                {s.transform && ` · ${s.transform}`}
                {s.licence && ` · ${s.licence}`}
              </li>
            ))}
          </ul>
        </details>
        <button
          type="button"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 9.5,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            background: 'transparent',
            color: 'var(--teal)',
            border: '1px solid var(--teal-dim)',
            padding: '4px 8px',
            borderRadius: 2,
            cursor: 'pointer',
          }}
          onClick={() => alert('N-Hop Actor Expander — Phase 4 (Sanctions workspace)')}
        >
          Expand actors →
        </button>
      </footer>
    </article>
  );
}

function PersonaFooter({ label, body }: { label: string; body: string }) {
  return (
    <p
      style={{
        margin: '8px 0 0 0',
        padding: '6px 8px',
        borderLeft: '2px solid var(--teal)',
        background: 'rgba(25, 208, 184, 0.06)',
        fontFamily: 'var(--f-body)',
        fontSize: 11.5,
        color: 'var(--ink)',
        lineHeight: 1.5,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 9.5,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
          marginRight: 8,
        }}
      >
        {label}
      </span>
      {body}
    </p>
  );
}

function domainColour(d: FeedItem['domain']): string {
  switch (d) {
    case 'maritime':    return 'var(--teal)';
    case 'air_traffic': return 'var(--amber)';
    case 'conflict':    return 'var(--red)';
    case 'energy':      return 'var(--green)';
    case 'cross':       return 'var(--violet)';
  }
}
