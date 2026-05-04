'use client';
import { useEffect, useRef, useState } from 'react';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';
import { RulesList, type RulesListHandle } from '@/components/notif/RulesList';
import { RecentFiresList } from '@/components/notif/RecentFiresList';
import { SuggestionGrid } from '@/components/notif/SuggestionCard';
import {
  CROSS_DATA_SUGGESTIONS,
  PERSONA_SUGGESTIONS,
  type Suggestion,
} from '@/lib/notifications/suggestion-library';
import {
  PERSONAS,
  DEFAULT_PERSONA,
  isValidPersona,
  personaVisibility,
  type PersonaId,
} from '@/lib/intelligence-analyst/personas';
import {
  PERSONA_STORAGE_KEY,
  migrateAdvancedFlagFromActivePersona,
  readAdvancedFlag,
  resolvePersonaFromSearchParams,
  subscribeAdvancedFlag,
} from '@/lib/intelligence-analyst/persona-visibility';
import { captureBrowser } from '@/lib/analytics/client';

interface NotifShellProps {
  recentFilter: boolean;
}

/**
 * Notification Center chrome. Mirrors IntelShell:
 *   • TopNav + (optional) AI Chat side panel — chatOpen drives both
 *     the AI CHAT tab pressed-state and the panel column width.
 *   • Three-section main: persona selector, suggestion library,
 *     user's active rules list. PR 11 fills the suggestion library;
 *     PR 5 fills the rules list (the rule builder lives there).
 *   • When ?filter=recent is set, a "Recent fires (24 h)" section
 *     appears above the rules list — driven by the bell-glyph deep
 *     link.
 *
 * This PR ships the empty-state scaffolding only. Suggestion cards,
 * rule rows, and recent-fire rows are placeholders pointing at the
 * subsequent PRs.
 */
export function NotifShell({ recentFilter }: NotifShellProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [persona, setPersona] = useState<PersonaId>(DEFAULT_PERSONA);
  const [advancedEnabled, setAdvancedEnabled] = useState(false);

  // Hydrate persona on mount. Order: storage migration → URL param
  // (?persona=<id>, with ?p= as legacy alias) → localStorage → default.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (migrateAdvancedFlagFromActivePersona()) {
      const stored = localStorage.getItem(PERSONA_STORAGE_KEY);
      if (isValidPersona(stored)) {
        captureBrowser({
          event: 'persona_changed',
          from: null,
          to: stored,
          visibility: personaVisibility(stored),
          source: 'storage_migration',
        });
      }
    }
    setAdvancedEnabled(readAdvancedFlag());

    const url = new URL(window.location.href);
    const resolved = resolvePersonaFromSearchParams(url.searchParams);
    if (resolved) {
      setPersona(resolved.persona);
      captureBrowser({
        event: 'persona_changed',
        from: null,
        to: resolved.persona,
        visibility: personaVisibility(resolved.persona),
        source: 'url_param',
      });
      if (resolved.auto_enabled_advanced) setAdvancedEnabled(true);
      return;
    }
    const stored = localStorage.getItem(PERSONA_STORAGE_KEY);
    if (isValidPersona(stored)) setPersona(stored);
  }, []);

  // Cross-component sync — flip the toggle on /settings and the
  // dropdown above re-renders without a navigation.
  useEffect(() => {
    return subscribeAdvancedFlag(setAdvancedEnabled);
  }, []);

  const onPersonaChange = (next: PersonaId) => {
    setPersona(prev => {
      if (prev !== next) {
        captureBrowser({
          event: 'persona_changed',
          from: prev,
          to: next,
          visibility: personaVisibility(next),
          source: 'dropdown',
        });
      }
      return next;
    });
    if (typeof window !== 'undefined') {
      localStorage.setItem(PERSONA_STORAGE_KEY, next);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-void)' }}>
      <TopNav chatOpen={chatOpen} onChatToggle={() => setChatOpen(v => !v)} />
      <div className="flex-1 flex" style={{ minHeight: 0 }}>
        <main className="flex-1 min-w-0 overflow-auto">
          <NotifContentInner
            persona={persona}
            onPersonaChange={onPersonaChange}
            recentFilter={recentFilter}
            advancedEnabled={advancedEnabled}
          />
        </main>
        <aside
          className="transition-all duration-200 ease-in-out overflow-hidden"
          style={{
            width: chatOpen ? 'var(--chat-panel-width)' : 0,
            borderLeft: chatOpen ? '1px solid var(--rule-soft)' : 'none',
          }}
        >
          {chatOpen && <ChatPanel />}
        </aside>
      </div>
    </div>
  );
}

// ─── Main content ────────────────────────────────────────────────

function NotifContentInner({
  persona,
  onPersonaChange,
  recentFilter,
  advancedEnabled,
}: {
  persona: PersonaId;
  onPersonaChange: (p: PersonaId) => void;
  recentFilter: boolean;
  advancedEnabled: boolean;
}) {
  // RulesList exposes openBuilderWith() so the suggestion cards
  // above can pre-fill the same builder instance — no duplicate
  // form code, no separate modal.
  const rulesRef = useRef<RulesListHandle>(null);
  const onPickSuggestion = (s: Suggestion) => {
    rulesRef.current?.openBuilderWith(s);
  };

  return (
    <div style={{ padding: '32px 40px 56px', maxWidth: 1200, margin: '0 auto' }}>
      <Header persona={persona} onPersonaChange={onPersonaChange} advancedEnabled={advancedEnabled} />
      {recentFilter && <RecentFiresSection />}
      <SuggestionLibrarySection persona={persona} onPick={onPickSuggestion} />
      <CrossDataSuggestionsSection onPick={onPickSuggestion} />
      <RulesListSection persona={persona} rulesRef={rulesRef} />
    </div>
  );
}

function Header({
  persona,
  onPersonaChange,
  advancedEnabled,
}: {
  persona: PersonaId;
  onPersonaChange: (p: PersonaId) => void;
  advancedEnabled: boolean;
}) {
  return (
    <header style={{ marginBottom: 32 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Notification Center
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 28,
          fontWeight: 500,
          color: 'var(--ink)',
          letterSpacing: '0.04em',
          marginBottom: 8,
        }}
      >
        Personalised event alerts
      </h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: 13.5, maxWidth: 720, marginBottom: 20 }}>
        Pick a persona to surface starter rules tuned for your workflow. Every rule fires
        through your verified channels, respects a 6-hour cooldown by default, and is
        auditable in a per-user log.
      </p>
      <PersonaSelector persona={persona} onChange={onPersonaChange} advancedEnabled={advancedEnabled} />
    </header>
  );
}

function PersonaSelector({
  persona,
  onChange,
  advancedEnabled,
}: {
  persona: PersonaId;
  onChange: (p: PersonaId) => void;
  advancedEnabled: boolean;
}) {
  // Always include the active persona, even when it's advanced and
  // the toggle is off — so the user is never confused about what is
  // currently selected. Only the OPTIONS list narrows when the flag
  // is off.
  const options = PERSONAS.filter(
    p => advancedEnabled || p.visibility === 'default' || p.id === persona,
  );
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 4,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
        }}
      >
        Persona
      </span>
      <select
        value={persona}
        onChange={e => onChange(e.target.value as PersonaId)}
        style={{
          background: 'transparent',
          color: 'var(--ink)',
          border: 'none',
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          outline: 'none',
          cursor: 'pointer',
          appearance: 'none',
          paddingRight: 18,
        }}
      >
        {options.map(p => (
          <option key={p.id} value={p.id} style={{ background: 'var(--bg-panel)' }}>
            {p.label}
          </option>
        ))}
      </select>
      <span style={{ color: 'var(--ink-faint)', fontSize: 10 }}>▼</span>
    </label>
  );
}

// ─── Sections ────────────────────────────────────────────────────

function SectionHeading({ index, title, hint }: { index: string; title: string; hint?: string }) {
  return (
    <div style={{ marginTop: 28, marginBottom: 14, display: 'flex', alignItems: 'baseline', gap: 12 }}>
      <span
        className="panel-title"
        style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.22em' }}
      >
        <span className="idx">{index}</span>
        {title}
      </span>
      {hint && (
        <span style={{ color: 'var(--ink-faint)', fontSize: 11 }}>{hint}</span>
      )}
    </div>
  );
}

function RecentFiresSection() {
  return (
    <section>
      <SectionHeading index="A" title="Recent fires · last 24 hours" />
      <RecentFiresList hours={24} />
    </section>
  );
}

function SuggestionLibrarySection({
  persona,
  onPick,
}: {
  persona: PersonaId;
  onPick: (s: Suggestion) => void;
}) {
  const list = PERSONA_SUGGESTIONS[persona] ?? [];
  return (
    <section>
      <SectionHeading
        index="B"
        title="Suggested rules"
        hint={`tuned for ${persona}`}
      />
      <SuggestionGrid suggestions={list} onPick={onPick} />
    </section>
  );
}

function CrossDataSuggestionsSection({ onPick }: { onPick: (s: Suggestion) => void }) {
  return (
    <section>
      <SectionHeading
        index="B′"
        title="Cross-data AI suggestions"
        hint="multi-bucket · universal"
      />
      <SuggestionGrid suggestions={CROSS_DATA_SUGGESTIONS} onPick={onPick} />
    </section>
  );
}

function RulesListSection({
  persona,
  rulesRef,
}: {
  persona: PersonaId;
  rulesRef: React.RefObject<RulesListHandle>;
}) {
  return (
    <section>
      <SectionHeading index="C" title="Your rules" />
      <RulesList ref={rulesRef} persona={persona} />
    </section>
  );
}
