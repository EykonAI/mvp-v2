'use client';
import { useEffect, useState } from 'react';
import { RuleBuilder } from './RuleBuilder';
import type { PersonaId } from '@/lib/intelligence-analyst/personas';

// Section · C of /notif: list the user's rules with active toggle,
// last-fire timestamp, and delete. Renders the RuleBuilder above the
// list when "+ New rule" is clicked. PR 5 ships single-event only;
// PRs 7 / 8 add the other rule-type panes.

export interface Rule {
  id: string;
  name: string;
  rule_type: 'single_event' | 'multi_event' | 'outcome_ai' | 'cross_data_ai';
  config: Record<string, unknown>;
  channel_ids: string[];
  active: boolean;
  cooldown_minutes: number;
  persona: string | null;
  last_fired_at: string | null;
  created_at: string;
  updated_at: string;
}

export function RulesList({ persona }: { persona: PersonaId }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const r = await fetch('/api/notifications/rules', { cache: 'no-store' });
      if (!r.ok) {
        if (r.status === 403) setError('Notification rules require Pro or higher.');
        else setError(`Could not load rules (${r.status}).`);
        setRules([]);
        return;
      }
      const data = await r.json();
      setRules(data.rules ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
      setRules([]);
    }
  }

  async function onToggle(rule: Rule) {
    setError(null);
    const r = await fetch(`/api/notifications/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !rule.active }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      if (data.error === 'rule_limit_reached') {
        setError(
          `Active-rule cap reached for tier ${data.tier} (${data.limit}). Pause or delete a rule first.`,
        );
      } else {
        setError(data.error ?? `Update failed (${r.status}).`);
      }
      return;
    }
    await refresh();
  }

  async function onDelete(rule: Rule) {
    if (!window.confirm(`Delete "${rule.name}"? Its fire history is removed too.`)) return;
    setError(null);
    const r = await fetch(`/api/notifications/rules/${rule.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      setError(data.error ?? `Delete failed (${r.status}).`);
      return;
    }
    await refresh();
  }

  return (
    <div>
      {error && (
        <div
          style={{
            background: 'rgba(224, 93, 80, 0.1)',
            border: '1px solid rgba(224, 93, 80, 0.4)',
            color: 'var(--red)',
            padding: '8px 12px',
            borderRadius: 4,
            marginBottom: 12,
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      {showBuilder && (
        <RuleBuilder
          persona={persona}
          onCreated={() => {
            setShowBuilder(false);
            void refresh();
          }}
          onCancel={() => setShowBuilder(false)}
        />
      )}

      {!showBuilder && (
        <div style={{ marginBottom: 14 }}>
          <button type="button" onClick={() => setShowBuilder(true)} style={btnPrimary}>
            + New rule
          </button>
        </div>
      )}

      {rules === null ? (
        <p style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>Loading…</p>
      ) : rules.length === 0 ? (
        <div
          style={{
            padding: '20px 22px',
            background: 'var(--bg-panel)',
            border: '1px dashed var(--rule)',
            borderRadius: 4,
            color: 'var(--ink-dim)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10.5,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              marginBottom: 8,
            }}
          >
            No rules yet
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>
            Click <strong style={{ color: 'var(--teal)' }}>+ New rule</strong> above, or pick from
            the suggestion library once it lands in PR 11. Every rule fires through your verified
            channels, respects a {360 / 60}-hour default cooldown, and writes an entry in your fire log.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rules.map(rule => (
            <li
              key={rule.id}
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--rule)',
                borderRadius: 4,
                padding: '14px 16px',
                marginBottom: 10,
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 14,
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    color: 'var(--ink)',
                    fontSize: 14,
                    fontWeight: 500,
                    marginBottom: 4,
                  }}
                >
                  {rule.name}
                </div>
                <RuleMeta rule={rule} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => void onToggle(rule)} style={btnGhost}>
                  {rule.active ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(rule)}
                  style={{ ...btnGhost, color: 'var(--red)' }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleMeta({ rule }: { rule: Rule }) {
  const cfg = (rule.config ?? {}) as {
    tool?: string;
    filters?: Record<string, unknown>;
    predicates?: Array<{ tool?: string; filters?: Record<string, unknown> }>;
    window_hours?: number;
  };

  let toolSummary = '';
  let filterSummary = '';
  if (rule.rule_type === 'multi_event' && Array.isArray(cfg.predicates)) {
    toolSummary = `predicates: ${cfg.predicates.length} · window: ${cfg.window_hours ?? '?'}h`;
    filterSummary = cfg.predicates
      .map(p => p.tool ?? '?')
      .join(' + ');
  } else if (cfg.tool) {
    toolSummary = `tool: ${String(cfg.tool)}`;
    filterSummary =
      cfg.filters && typeof cfg.filters === 'object'
        ? Object.entries(cfg.filters)
            .filter(([, v]) => v !== '' && v !== 0 && v !== undefined && v !== null)
            .map(([k, v]) => `${k}=${v}`)
            .join(' · ')
        : '';
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        fontFamily: 'var(--f-mono)',
        fontSize: 10.5,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
      }}
    >
      <span style={{ color: rule.active ? 'var(--teal)' : 'var(--ink-dim)' }}>
        ● {rule.active ? 'active' : 'paused'}
      </span>
      <span>{rule.rule_type.replace('_', ' ')}</span>
      {toolSummary && <span>{toolSummary}</span>}
      <span>cooldown: {rule.cooldown_minutes}m</span>
      <span>channels: {rule.channel_ids.length}</span>
      {rule.last_fired_at && (
        <span>last fire: {new Date(rule.last_fired_at).toLocaleString()}</span>
      )}
      {!rule.last_fired_at && <span>never fired</span>}
      {filterSummary && (
        <span style={{ color: 'var(--ink-dim)', textTransform: 'none', letterSpacing: 'normal' }}>
          {filterSummary}
        </span>
      )}
    </div>
  );
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
  fontSize: 10.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  padding: '5px 12px',
  background: 'transparent',
  color: 'var(--ink-dim)',
  border: '1px solid var(--rule-strong)',
  borderRadius: 2,
  cursor: 'pointer',
};
