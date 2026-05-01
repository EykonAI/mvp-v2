'use client';
import { useEffect, useState } from 'react';
import TopNav from '@/components/TopNav';
import ChatPanel from '@/components/ChatPanel';
import { RulesList } from '@/components/notif/RulesList';
import { PERSONAS, DEFAULT_PERSONA, isValidPersona, type PersonaId } from '@/lib/intelligence-analyst/personas';

// Single-key localStorage source of truth shared with the AI Chat
// panel. Brief §10: "reuse the single global persona stored in
// localStorage". Same key as ChatPanel + intel PersonaContext —
// keep these aligned so picking a persona on /notif also flips the
// chat panel and vice versa.
const PERSONA_STORAGE_KEY = 'eykon.persona';

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

  // Hydrate persona from localStorage on mount; fall back to default
  // when nothing is stored (true first-time user). Reads only — write
  // happens in the change handler below.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(PERSONA_STORAGE_KEY);
    if (isValidPersona(stored)) setPersona(stored);
  }, []);

  const onPersonaChange = (next: PersonaId) => {
    setPersona(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(PERSONA_STORAGE_KEY, next);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-void)' }}>
      <TopNav chatOpen={chatOpen} onChatToggle={() => setChatOpen(v => !v)} />
      <div className="flex-1 flex" style={{ minHeight: 0 }}>
        <main className="flex-1 min-w-0 overflow-auto">
          <NotifContent
            persona={persona}
            onPersonaChange={onPersonaChange}
            recentFilter={recentFilter}
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

function NotifContent({
  persona,
  onPersonaChange,
  recentFilter,
}: {
  persona: PersonaId;
  onPersonaChange: (p: PersonaId) => void;
  recentFilter: boolean;
}) {
  return (
    <div style={{ padding: '32px 40px 56px', maxWidth: 1200, margin: '0 auto' }}>
      <Header persona={persona} onPersonaChange={onPersonaChange} />
      {recentFilter && <RecentFiresSection />}
      <SuggestionLibrarySection persona={persona} />
      <RulesListSection persona={persona} />
    </div>
  );
}

function Header({
  persona,
  onPersonaChange,
}: {
  persona: PersonaId;
  onPersonaChange: (p: PersonaId) => void;
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
      <PersonaSelector persona={persona} onChange={onPersonaChange} />
    </header>
  );
}

function PersonaSelector({
  persona,
  onChange,
}: {
  persona: PersonaId;
  onChange: (p: PersonaId) => void;
}) {
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
        {PERSONAS.map(p => (
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

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
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
        {title}
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

function RecentFiresSection() {
  return (
    <section>
      <SectionHeading index="A" title="Recent fires · last 24 hours" />
      <PlaceholderCard
        title="No fires yet"
        body="Once you enable a rule, every fire appears here with the matching event payload, AI rationale (where applicable), and per-channel delivery status."
      />
    </section>
  );
}

function SuggestionLibrarySection({ persona }: { persona: PersonaId }) {
  return (
    <section>
      <SectionHeading
        index="B"
        title="Suggested rules"
        hint={`tuned for ${persona}`}
      />
      <PlaceholderCard
        title="Suggestion library — landing in PR 11"
        body="Persona-specific starter rules covering single-event, multi-event, outcome-driven AI, and cross-data AI types. Click any card to drop it into the rule builder pre-filled, then review channels and cooldown before enabling."
      />
    </section>
  );
}

function RulesListSection({ persona }: { persona: PersonaId }) {
  return (
    <section>
      <SectionHeading index="C" title="Your rules" />
      <RulesList persona={persona} />
    </section>
  );
}
