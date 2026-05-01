'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  SINGLE_EVENT_TOOLS,
  type SingleEventToolId,
  type FilterValue,
  type DataBucket,
  suggestRuleName,
  suggestMultiEventRuleName,
  suggestAiRuleName,
  DATA_BUCKETS,
  CROSS_DATA_AI_MIN_BUCKETS,
  MULTI_EVENT_MIN_PREDICATES,
  MULTI_EVENT_MAX_PREDICATES,
  MULTI_EVENT_DEFAULT_WINDOW_HOURS,
  MULTI_EVENT_MIN_WINDOW_HOURS,
  MULTI_EVENT_MAX_WINDOW_HOURS,
  OUTCOME_STATEMENT_MAX_CHARS,
  OUTCOME_STATEMENT_MIN_CHARS,
} from '@/lib/notifications/tools';
import { DEFAULT_COOLDOWN_MINUTES, MIN_COOLDOWN_MINUTES } from '@/lib/notifications/rule-limits';
import type { PersonaId } from '@/lib/intelligence-analyst/personas';

// Inline rule builder. Supports single_event (PR 5) and multi_event
// (PR 7). Outcome-AI / cross-data-AI panes arrive in PR 8 — the
// rule-type segmented control already shows them, disabled, with a
// "PR 8" hint so the affordance is discoverable.
//
// Channels come from /api/notifications/channels filtered to verified-
// and-active rows. If the user has none, the form shows a CTA pointing
// at /settings instead of letting them save a rule that can't fire.

interface VerifiedChannel {
  id: string;
  channel_type: 'email' | 'sms' | 'whatsapp';
  handle: string;
  label: string | null;
}

type RuleMode = 'single_event' | 'multi_event' | 'outcome_ai' | 'cross_data_ai';

interface PredicateState {
  tool: SingleEventToolId;
  filters: Record<string, FilterValue>;
}

interface RuleBuilderProps {
  persona: PersonaId;
  onCreated: () => void;
  onCancel: () => void;
}

export function RuleBuilder({ persona, onCreated, onCancel }: RuleBuilderProps) {
  const [mode, setMode] = useState<RuleMode>('single_event');

  // Single-event state
  const [tool, setTool] = useState<SingleEventToolId>(SINGLE_EVENT_TOOLS[0].id);
  const [filters, setFilters] = useState<Record<string, FilterValue>>(() =>
    initialFilters(SINGLE_EVENT_TOOLS[0].id),
  );

  // Multi-event state
  const [predicates, setPredicates] = useState<PredicateState[]>(() => [
    { tool: SINGLE_EVENT_TOOLS[0].id, filters: initialFilters(SINGLE_EVENT_TOOLS[0].id) },
    { tool: SINGLE_EVENT_TOOLS[1].id, filters: initialFilters(SINGLE_EVENT_TOOLS[1].id) },
  ]);
  const [windowHours, setWindowHours] = useState<number>(MULTI_EVENT_DEFAULT_WINDOW_HOURS);

  // AI rules state
  const [outcomeStatement, setOutcomeStatement] = useState('');
  const [aiBuckets, setAiBuckets] = useState<DataBucket[]>([]);

  // Shared state
  const [name, setName] = useState('');
  const [cooldown, setCooldown] = useState<number>(DEFAULT_COOLDOWN_MINUTES);
  const [channels, setChannels] = useState<VerifiedChannel[] | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/notifications/channels', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { channels: [] }))
      .then(
        (data: {
          channels?: Array<VerifiedChannel & { verified_at: string | null; active: boolean }>;
        }) => {
          if (cancelled) return;
          const verified = (data.channels ?? [])
            .filter(c => c.verified_at && c.active)
            .map(c => ({
              id: c.id,
              channel_type: c.channel_type,
              handle: c.handle,
              label: c.label,
            }));
          setChannels(verified);
          const defaultId =
            verified.find(c => c.channel_type === 'email')?.id ?? verified[0]?.id;
          if (defaultId) setSelectedChannelIds([defaultId]);
        },
      )
      .catch(() => setChannels([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const placeholderName = useMemo(() => {
    if (mode === 'single_event') return suggestRuleName(tool, filters);
    if (mode === 'multi_event')
      return suggestMultiEventRuleName({
        predicates: predicates.map(p => ({ tool: p.tool, filters: p.filters })),
        window_hours: windowHours,
      });
    return suggestAiRuleName(mode, outcomeStatement || '(outcome statement)');
  }, [mode, tool, filters, predicates, windowHours, outcomeStatement]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const config =
        mode === 'single_event'
          ? { tool, filters }
          : mode === 'multi_event'
          ? {
              predicates: predicates.map(p => ({ tool: p.tool, filters: p.filters })),
              window_hours: windowHours,
            }
          : { outcome_statement: outcomeStatement.trim(), buckets: aiBuckets };
      const r = await fetch('/api/notifications/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_type: mode,
          name: name.trim() || placeholderName,
          persona,
          cooldown_minutes: cooldown,
          channel_ids: selectedChannelIds,
          active: true,
          config,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(humanizeCreateError(data));
        return;
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={formStyle}>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
        }}
      >
        New rule
      </div>

      <ModeSelector mode={mode} onChange={setMode} />

      {error && (
        <div
          style={{
            background: 'rgba(224, 93, 80, 0.1)',
            border: '1px solid rgba(224, 93, 80, 0.4)',
            color: 'var(--red)',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      {mode === 'single_event' && (
        <SingleEventFields
          tool={tool}
          filters={filters}
          onToolChange={next => {
            setTool(next);
            setFilters(initialFilters(next));
          }}
          onFilterChange={(id, raw, type) =>
            setFilters(prev => ({
              ...prev,
              [id]: type === 'number' ? (raw === '' ? 0 : Number(raw)) : raw,
            }))
          }
        />
      )}

      {mode === 'multi_event' && (
        <MultiEventFields
          predicates={predicates}
          windowHours={windowHours}
          onPredicateChange={(idx, next) =>
            setPredicates(prev => prev.map((p, i) => (i === idx ? next : p)))
          }
          onAddPredicate={() =>
            setPredicates(prev =>
              prev.length >= MULTI_EVENT_MAX_PREDICATES
                ? prev
                : [...prev, { tool: SINGLE_EVENT_TOOLS[0].id, filters: initialFilters(SINGLE_EVENT_TOOLS[0].id) }],
            )
          }
          onRemovePredicate={idx =>
            setPredicates(prev =>
              prev.length <= MULTI_EVENT_MIN_PREDICATES ? prev : prev.filter((_, i) => i !== idx),
            )
          }
          onWindowChange={setWindowHours}
        />
      )}

      {(mode === 'outcome_ai' || mode === 'cross_data_ai') && (
        <AiFields
          mode={mode}
          outcomeStatement={outcomeStatement}
          onOutcomeChange={setOutcomeStatement}
          buckets={aiBuckets}
          onBucketsChange={setAiBuckets}
        />
      )}

      <label style={fieldLabel}>
        Name (optional)
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={placeholderName}
          style={inputStyle}
        />
      </label>

      <label style={fieldLabel}>
        Cooldown (minutes; minimum {MIN_COOLDOWN_MINUTES})
        <input
          type="number"
          min={MIN_COOLDOWN_MINUTES}
          value={cooldown}
          onChange={e => setCooldown(Math.max(MIN_COOLDOWN_MINUTES, Number(e.target.value) || 0))}
          style={inputStyle}
        />
      </label>

      <fieldset style={{ ...fieldLabel, border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ marginBottom: 4 }}>Channels</legend>
        {channels === null ? (
          <span style={hintStyle}>Loading channels…</span>
        ) : channels.length === 0 ? (
          <span style={hintStyle}>
            No verified channels yet.{' '}
            <a href="/settings" style={{ color: 'var(--teal)' }}>
              Add one in Settings →
            </a>
          </span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {channels.map(c => (
              <label key={c.id} style={channelChip(selectedChannelIds.includes(c.id))}>
                <input
                  type="checkbox"
                  checked={selectedChannelIds.includes(c.id)}
                  onChange={e =>
                    setSelectedChannelIds(prev =>
                      e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id),
                    )
                  }
                  style={{ marginRight: 6 }}
                />
                <span
                  style={{
                    textTransform: 'uppercase',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    marginRight: 6,
                  }}
                >
                  {c.channel_type}
                </span>
                {c.label ?? c.handle}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
        <button type="button" onClick={onCancel} style={btnGhost}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={
            submitting ||
            selectedChannelIds.length === 0 ||
            ((mode === 'outcome_ai' || mode === 'cross_data_ai') &&
              outcomeStatement.trim().length < OUTCOME_STATEMENT_MIN_CHARS) ||
            (mode === 'cross_data_ai' && aiBuckets.length < CROSS_DATA_AI_MIN_BUCKETS)
          }
          style={btnPrimary}
        >
          {submitting ? 'Saving…' : 'Enable rule'}
        </button>
      </div>
    </form>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function ModeSelector({ mode, onChange }: { mode: RuleMode; onChange: (m: RuleMode) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        background: 'var(--bg-void)',
        border: '1px solid var(--rule)',
        borderRadius: 3,
        padding: 2,
        alignSelf: 'flex-start',
        flexWrap: 'wrap',
      }}
    >
      <ModeTab label="Single event" active={mode === 'single_event'} onClick={() => onChange('single_event')} />
      <ModeTab label="Multi-event" active={mode === 'multi_event'} onClick={() => onChange('multi_event')} />
      <ModeTab label="Outcome AI" active={mode === 'outcome_ai'} onClick={() => onChange('outcome_ai')} />
      <ModeTab label="Cross-data AI" active={mode === 'cross_data_ai'} onClick={() => onChange('cross_data_ai')} />
    </div>
  );
}

function ModeTab({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        padding: '6px 12px',
        background: active ? 'var(--teal)' : 'transparent',
        color: active ? 'var(--bg-void)' : disabled ? 'var(--ink-ghost)' : 'var(--ink-dim)',
        border: 'none',
        borderRadius: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: active ? 500 : 400,
      }}
    >
      {label}
    </button>
  );
}

function SingleEventFields({
  tool,
  filters,
  onToolChange,
  onFilterChange,
}: {
  tool: SingleEventToolId;
  filters: Record<string, FilterValue>;
  onToolChange: (next: SingleEventToolId) => void;
  onFilterChange: (id: string, raw: string, type: 'string' | 'number') => void;
}) {
  const toolDef = SINGLE_EVENT_TOOLS.find(t => t.id === tool) ?? SINGLE_EVENT_TOOLS[0];
  return (
    <>
      <label style={fieldLabel}>
        Tool
        <select
          value={tool}
          onChange={e => onToolChange(e.target.value as SingleEventToolId)}
          style={inputStyle}
        >
          {SINGLE_EVENT_TOOLS.map(t => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <span style={hintStyle}>{toolDef.description}</span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {toolDef.filters.map(f => (
          <label key={f.id} style={fieldLabel}>
            {f.label}
            <input
              type={f.type === 'number' ? 'number' : 'text'}
              value={String(filters[f.id] ?? f.default)}
              onChange={e => onFilterChange(f.id, e.target.value, f.type)}
              style={inputStyle}
            />
          </label>
        ))}
      </div>
    </>
  );
}

function MultiEventFields({
  predicates,
  windowHours,
  onPredicateChange,
  onAddPredicate,
  onRemovePredicate,
  onWindowChange,
}: {
  predicates: PredicateState[];
  windowHours: number;
  onPredicateChange: (idx: number, next: PredicateState) => void;
  onAddPredicate: () => void;
  onRemovePredicate: (idx: number) => void;
  onWindowChange: (n: number) => void;
}) {
  return (
    <>
      <label style={fieldLabel}>
        Co-occurrence window (hours; {MULTI_EVENT_MIN_WINDOW_HOURS}–{MULTI_EVENT_MAX_WINDOW_HOURS})
        <input
          type="number"
          min={MULTI_EVENT_MIN_WINDOW_HOURS}
          max={MULTI_EVENT_MAX_WINDOW_HOURS}
          value={windowHours}
          onChange={e =>
            onWindowChange(
              Math.min(
                MULTI_EVENT_MAX_WINDOW_HOURS,
                Math.max(MULTI_EVENT_MIN_WINDOW_HOURS, Number(e.target.value) || 0),
              ),
            )
          }
          style={inputStyle}
        />
        <span style={hintStyle}>
          Fires when every predicate has at least one match AND the matches are spread within this window.
        </span>
      </label>
      {predicates.map((pred, idx) => (
        <PredicateCard
          key={idx}
          index={idx}
          predicate={pred}
          canRemove={predicates.length > MULTI_EVENT_MIN_PREDICATES}
          onChange={next => onPredicateChange(idx, next)}
          onRemove={() => onRemovePredicate(idx)}
        />
      ))}
      {predicates.length < MULTI_EVENT_MAX_PREDICATES && (
        <button type="button" onClick={onAddPredicate} style={{ ...btnGhost, alignSelf: 'flex-start' }}>
          + Add predicate
        </button>
      )}
    </>
  );
}

function AiFields({
  mode,
  outcomeStatement,
  onOutcomeChange,
  buckets,
  onBucketsChange,
}: {
  mode: 'outcome_ai' | 'cross_data_ai';
  outcomeStatement: string;
  onOutcomeChange: (s: string) => void;
  buckets: DataBucket[];
  onBucketsChange: (b: DataBucket[]) => void;
}) {
  const remainingChars = OUTCOME_STATEMENT_MAX_CHARS - outcomeStatement.length;
  return (
    <>
      <label style={fieldLabel}>
        Outcome statement
        <textarea
          value={outcomeStatement}
          onChange={e => onOutcomeChange(e.target.value.slice(0, OUTCOME_STATEMENT_MAX_CHARS))}
          rows={3}
          maxLength={OUTCOME_STATEMENT_MAX_CHARS}
          placeholder={
            mode === 'outcome_ai'
              ? 'Anything that could move WTI by ≥$2/bbl in the next 24 hours.'
              : 'Convergence of conflict + maritime + energy signals affecting Hormuz.'
          }
          style={{ ...inputStyle, minHeight: 70, lineHeight: 1.4 }}
        />
        <span style={hintStyle}>
          {outcomeStatement.length} / {OUTCOME_STATEMENT_MAX_CHARS} chars
          {outcomeStatement.length > 0 && outcomeStatement.length < OUTCOME_STATEMENT_MIN_CHARS
            ? ` · need at least ${OUTCOME_STATEMENT_MIN_CHARS}`
            : ''}
          {remainingChars < 60 ? ` · ${remainingChars} left` : ''}
        </span>
      </label>

      <fieldset style={{ ...fieldLabel, border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ marginBottom: 4 }}>
          Data buckets
          {mode === 'cross_data_ai' && (
            <span style={{ ...hintStyle, marginLeft: 8 }}>
              (≥{CROSS_DATA_AI_MIN_BUCKETS} required)
            </span>
          )}
        </legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DATA_BUCKETS.map(b => {
            const active = buckets.includes(b);
            return (
              <label key={b} style={channelChip(active)}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={e =>
                    onBucketsChange(
                      e.target.checked ? [...buckets, b] : buckets.filter(x => x !== b),
                    )
                  }
                  style={{ marginRight: 6 }}
                />
                {b}
              </label>
            );
          })}
        </div>
        <span style={hintStyle}>
          {mode === 'outcome_ai'
            ? 'Leave empty to let the evaluator sample from every bucket.'
            : 'Cross-data rules require at least 2 buckets — fires only when the model finds supporting events spanning ≥2 of them.'}
        </span>
      </fieldset>
    </>
  );
}

function PredicateCard({
  index,
  predicate,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  predicate: PredicateState;
  canRemove: boolean;
  onChange: (next: PredicateState) => void;
  onRemove: () => void;
}) {
  const toolDef = SINGLE_EVENT_TOOLS.find(t => t.id === predicate.tool) ?? SINGLE_EVENT_TOOLS[0];
  return (
    <div
      style={{
        background: 'var(--bg-void)',
        border: '1px solid var(--rule)',
        borderRadius: 4,
        padding: '12px 14px',
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
          }}
        >
          Predicate {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            style={{ ...btnGhost, padding: '3px 10px', fontSize: 10 }}
          >
            Remove
          </button>
        )}
      </div>
      <label style={fieldLabel}>
        Tool
        <select
          value={predicate.tool}
          onChange={e => {
            const next = e.target.value as SingleEventToolId;
            onChange({ tool: next, filters: initialFilters(next) });
          }}
          style={inputStyle}
        >
          {SINGLE_EVENT_TOOLS.map(t => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {toolDef.filters.map(f => (
          <label key={f.id} style={fieldLabel}>
            {f.label}
            <input
              type={f.type === 'number' ? 'number' : 'text'}
              value={String(predicate.filters[f.id] ?? f.default)}
              onChange={e => {
                const raw = e.target.value;
                const value: FilterValue =
                  f.type === 'number' ? (raw === '' ? 0 : Number(raw)) : raw;
                onChange({
                  tool: predicate.tool,
                  filters: { ...predicate.filters, [f.id]: value },
                });
              }}
              style={inputStyle}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers + styles ────────────────────────────────────────────

function initialFilters(toolId: SingleEventToolId): Record<string, FilterValue> {
  const tool = SINGLE_EVENT_TOOLS.find(t => t.id === toolId);
  if (!tool) return {};
  return Object.fromEntries(tool.filters.map(f => [f.id, f.default]));
}

function humanizeCreateError(data: {
  error?: string;
  limit?: number;
  tier?: string;
  hint?: string;
  min?: number;
  max?: number;
}): string {
  switch (data.error) {
    case 'rule_limit_reached':
      return `Active-rule cap reached for tier ${data.tier} (${data.limit}). Pause or delete a rule first.`;
    case 'no_channels':
      return 'Pick at least one channel.';
    case 'no_verified_channels':
      return 'None of the selected channels are verified. Verify one in Settings first.';
    case 'invalid_tool':
      return 'Invalid tool selection.';
    case 'invalid_predicate':
      return 'One of the predicates references an unknown tool.';
    case 'too_few_predicates':
      return `Multi-event rules need at least ${data.min} predicates.`;
    case 'too_many_predicates':
      return `Multi-event rules allow at most ${data.max} predicates.`;
    case 'outcome_statement_too_short':
      return `Outcome statement needs at least ${data.min} characters.`;
    case 'outcome_statement_too_long':
      return `Outcome statement is too long (max ${data.max} chars).`;
    case 'too_few_buckets':
      return `Cross-data rules need at least ${data.min} data buckets.`;
    case 'unsupported_rule_type':
      return data.hint ?? 'This rule type is not yet supported.';
    case 'forbidden':
      return 'Rule creation requires Pro or higher.';
    default:
      return data.error ?? 'Could not create rule.';
  }
}

const formStyle: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--rule-strong)',
  borderRadius: 6,
  padding: '20px 22px',
  marginBottom: 18,
  display: 'grid',
  gap: 14,
};

const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-faint)',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-void)',
  border: '1px solid var(--rule)',
  borderRadius: 3,
  padding: '6px 10px',
  color: 'var(--ink)',
  fontFamily: 'var(--f-body)',
  fontSize: 13,
  letterSpacing: 'normal',
  textTransform: 'none',
  outline: 'none',
};

const hintStyle: React.CSSProperties = {
  fontFamily: 'var(--f-body)',
  fontSize: 11.5,
  letterSpacing: 'normal',
  textTransform: 'none',
  color: 'var(--ink-faint)',
};

function channelChip(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 10px',
    background: active ? 'rgba(25, 208, 184, 0.12)' : 'var(--bg-void)',
    border: `1px solid ${active ? 'var(--teal)' : 'var(--rule)'}`,
    borderRadius: 3,
    color: 'var(--ink)',
    fontSize: 12.5,
    cursor: 'pointer',
  };
}

const btnPrimary: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  padding: '8px 16px',
  background: 'var(--teal)',
  color: 'var(--bg-void)',
  border: '1px solid var(--teal)',
  borderRadius: 2,
  cursor: 'pointer',
  fontWeight: 500,
};

const btnGhost: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  padding: '8px 16px',
  background: 'transparent',
  color: 'var(--ink-dim)',
  border: '1px solid var(--rule-strong)',
  borderRadius: 2,
  cursor: 'pointer',
};
