'use client';
import {
  type Suggestion,
  suggestionBucketCount,
} from '@/lib/notifications/suggestion-library';

// Single suggestion card — used by both the persona-specific list
// (§4) and the universal cross-data block (§5). Click hands the
// suggestion up to the parent, which opens the RuleBuilder pre-
// filled.

const TYPE_LABEL: Record<string, string> = {
  single_event: 'Single event',
  multi_event: 'Multi-event',
  outcome_ai: 'Outcome AI',
  cross_data_ai: 'Cross-data AI',
};

const TYPE_COLOR: Record<string, string> = {
  single_event: 'var(--ink-dim)',
  multi_event: 'var(--violet)',
  outcome_ai: 'var(--teal)',
  cross_data_ai: 'var(--amber)',
};

export function SuggestionCard({
  suggestion,
  onPick,
}: {
  suggestion: Suggestion;
  onPick: (s: Suggestion) => void;
}) {
  const ruleType = suggestion.config.rule_type;
  const bucketCount = suggestionBucketCount(suggestion);
  const showBucketBadge =
    ruleType === 'cross_data_ai' || (ruleType === 'outcome_ai' && bucketCount > 0);

  return (
    <button
      type="button"
      onClick={() => onPick(suggestion)}
      style={{
        textAlign: 'left',
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 4,
        padding: '14px 16px',
        cursor: 'pointer',
        color: 'var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 110,
        transition: 'border-color 120ms, background 120ms',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--teal-dim)';
        e.currentTarget.style.background = 'var(--bg-raised)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--rule)';
        e.currentTarget.style.background = 'var(--bg-panel)';
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: TYPE_COLOR[ruleType] ?? 'var(--ink-dim)',
        }}
      >
        <span>{TYPE_LABEL[ruleType] ?? ruleType}</span>
        {showBucketBadge && (
          <span
            style={{
              padding: '1px 7px',
              borderRadius: 9,
              border: `1px solid ${TYPE_COLOR[ruleType] ?? 'var(--rule-strong)'}`,
              fontSize: 9.5,
              letterSpacing: '0.12em',
            }}
          >
            × {bucketCount}
          </span>
        )}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.4 }}>{suggestion.title}</div>
      <div
        style={{
          marginTop: 'auto',
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
        }}
      >
        + Enable →
      </div>
    </button>
  );
}

export function SuggestionGrid({
  suggestions,
  onPick,
}: {
  suggestions: Suggestion[];
  onPick: (s: Suggestion) => void;
}) {
  if (suggestions.length === 0) {
    return (
      <div
        style={{
          padding: '20px 22px',
          background: 'var(--bg-panel)',
          border: '1px dashed var(--rule)',
          borderRadius: 4,
          color: 'var(--ink-faint)',
          fontSize: 12.5,
        }}
      >
        No starter rules yet for this persona.
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 10,
      }}
    >
      {suggestions.map(s => (
        <SuggestionCard key={s.id} suggestion={s} onPick={onPick} />
      ))}
    </div>
  );
}
