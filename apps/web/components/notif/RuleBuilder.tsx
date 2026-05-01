'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  SINGLE_EVENT_TOOLS,
  type SingleEventToolId,
  type FilterValue,
  suggestRuleName,
} from '@/lib/notifications/tools';
import { DEFAULT_COOLDOWN_MINUTES, MIN_COOLDOWN_MINUTES } from '@/lib/notifications/rule-limits';
import type { PersonaId } from '@/lib/intelligence-analyst/personas';

// Inline rule builder for the single-event mode (PR 5). Multi-event,
// outcome-AI, and cross-data-AI rule types add their own panes in
// PRs 7 and 8 — this file owns single_event only.
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

interface RuleBuilderProps {
  persona: PersonaId;
  onCreated: () => void;
  onCancel: () => void;
}

export function RuleBuilder({ persona, onCreated, onCancel }: RuleBuilderProps) {
  const [tool, setTool] = useState<SingleEventToolId>(SINGLE_EVENT_TOOLS[0].id);
  const [filters, setFilters] = useState<Record<string, FilterValue>>(() =>
    initialFilters(SINGLE_EVENT_TOOLS[0].id),
  );
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
      .then((data: { channels?: Array<VerifiedChannel & { verified_at: string | null; active: boolean }> }) => {
        if (cancelled) return;
        const verified = (data.channels ?? [])
          .filter(c => c.verified_at && c.active)
          .map(c => ({ id: c.id, channel_type: c.channel_type, handle: c.handle, label: c.label }));
        setChannels(verified);
        // Default-select the user's email channel (most users will
        // have one); if none, the first verified row of any kind.
        const defaultId =
          verified.find(c => c.channel_type === 'email')?.id ?? verified[0]?.id;
        if (defaultId) setSelectedChannelIds([defaultId]);
      })
      .catch(() => setChannels([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const toolDef = useMemo(
    () => SINGLE_EVENT_TOOLS.find(t => t.id === tool) ?? SINGLE_EVENT_TOOLS[0],
    [tool],
  );

  function onToolChange(next: SingleEventToolId) {
    setTool(next);
    setFilters(initialFilters(next));
    setName('');
  }

  function setFilter(id: string, raw: string, type: 'string' | 'number') {
    setFilters(prev => ({
      ...prev,
      [id]: type === 'number' ? (raw === '' ? 0 : Number(raw)) : raw,
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/notifications/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_type: 'single_event',
          name: name.trim() || suggestRuleName(tool, filters),
          persona,
          cooldown_minutes: cooldown,
          channel_ids: selectedChannelIds,
          active: true,
          config: { tool, filters },
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
    <form
      onSubmit={onSubmit}
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule-strong)',
        borderRadius: 6,
        padding: '20px 22px',
        marginBottom: 18,
        display: 'grid',
        gap: 14,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--teal)',
        }}
      >
        New rule · single event
      </div>

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

      <label style={fieldLabel}>
        Tool
        <select value={tool} onChange={e => onToolChange(e.target.value as SingleEventToolId)} style={inputStyle}>
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
              onChange={e => setFilter(f.id, e.target.value, f.type)}
              style={inputStyle}
            />
          </label>
        ))}
      </div>

      <label style={fieldLabel}>
        Name (optional)
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={suggestRuleName(tool, filters)}
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
            No verified channels yet. <a href="/settings" style={{ color: 'var(--teal)' }}>Add one in Settings →</a>
          </span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {channels.map(c => (
              <label key={c.id} style={channelChip(selectedChannelIds.includes(c.id))}>
                <input
                  type="checkbox"
                  checked={selectedChannelIds.includes(c.id)}
                  onChange={e => {
                    setSelectedChannelIds(prev =>
                      e.target.checked
                        ? [...prev, c.id]
                        : prev.filter(id => id !== c.id),
                    );
                  }}
                  style={{ marginRight: 6 }}
                />
                <span style={{ textTransform: 'uppercase', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.14em', marginRight: 6 }}>
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
          disabled={submitting || selectedChannelIds.length === 0}
          style={btnPrimary}
        >
          {submitting ? 'Saving…' : 'Enable rule'}
        </button>
      </div>
    </form>
  );
}

function initialFilters(toolId: SingleEventToolId): Record<string, FilterValue> {
  const tool = SINGLE_EVENT_TOOLS.find(t => t.id === toolId);
  if (!tool) return {};
  return Object.fromEntries(tool.filters.map(f => [f.id, f.default]));
}

function humanizeCreateError(data: { error?: string; limit?: number; tier?: string; hint?: string }): string {
  switch (data.error) {
    case 'rule_limit_reached':
      return `Active-rule cap reached for tier ${data.tier} (${data.limit}). Pause or delete a rule before adding another.`;
    case 'no_channels':
      return 'Pick at least one channel.';
    case 'no_verified_channels':
      return 'None of the selected channels are verified. Verify one in Settings first.';
    case 'invalid_tool':
      return 'Invalid tool selection.';
    case 'unsupported_rule_type':
      return data.hint ?? 'This rule type is not yet supported.';
    case 'forbidden':
      return 'Rule creation requires Pro or higher.';
    default:
      return data.error ?? 'Could not create rule.';
  }
}

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
