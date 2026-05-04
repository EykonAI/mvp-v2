'use client';
import { useEffect, useState } from 'react';
import {
  PERSONA_STORAGE_KEY,
  readAdvancedFlag,
  subscribeAdvancedFlag,
  writeAdvancedFlag,
} from '@/lib/intelligence-analyst/persona-visibility';
import {
  DEFAULT_PERSONA,
  isValidPersona,
  personaLabel,
  personaVisibility,
  type PersonaId,
} from '@/lib/intelligence-analyst/personas';
import { captureBrowser } from '@/lib/analytics/client';

// Single Settings card with the "Show advanced personas" switch.
//
// Behaviour:
//   • Default off — flips the localStorage gate.
//   • If the user flips OFF while their currently-active persona is
//     advanced, we DO NOT silently reset their persona. Instead we
//     show a confirm dialog: "Switch to OSINT Analyst now, or keep
//     the current persona active?"
//   • Cross-tab sync via the persona-visibility CustomEvent.

export function AdvancedPersonasCard() {
  const [enabled, setEnabled] = useState(false);
  const [activePersona, setActivePersona] = useState<PersonaId>(DEFAULT_PERSONA);
  const [confirm, setConfirm] = useState<null | { activeLabel: string }>(null);

  useEffect(() => {
    setEnabled(readAdvancedFlag());
    const stored = window.localStorage.getItem(PERSONA_STORAGE_KEY);
    if (isValidPersona(stored)) setActivePersona(stored);
    return subscribeAdvancedFlag(setEnabled);
  }, []);

  const fireToggleEvent = (next: boolean, persona: PersonaId) => {
    captureBrowser({
      event: 'advanced_personas_toggled',
      enabled: next,
      active_persona: persona,
      active_persona_visibility: personaVisibility(persona),
    });
  };

  const onToggle = () => {
    const next = !enabled;
    if (!next && personaVisibility(activePersona) === 'advanced') {
      // Trying to flip OFF while an advanced persona is active —
      // ask the user what they want to do before we hide it.
      setConfirm({ activeLabel: personaLabel(activePersona) });
      return;
    }
    setEnabled(next);
    writeAdvancedFlag(next);
    fireToggleEvent(next, activePersona);
  };

  const onConfirmSwitchAndHide = () => {
    setEnabled(false);
    writeAdvancedFlag(false);
    window.localStorage.setItem(PERSONA_STORAGE_KEY, DEFAULT_PERSONA);
    setActivePersona(DEFAULT_PERSONA);
    captureBrowser({
      event: 'persona_changed',
      from: activePersona,
      to: DEFAULT_PERSONA,
      visibility: 'default',
      source: 'dropdown',
    });
    fireToggleEvent(false, DEFAULT_PERSONA);
    setConfirm(null);
  };

  const onConfirmKeepCurrent = () => {
    // User keeps the advanced persona active; the toggle stays ON
    // because hiding it while the active persona is advanced would
    // leave them with a dropdown that doesn't show their selection.
    setConfirm(null);
  };

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        padding: '24px 28px',
        marginBottom: 24,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          marginBottom: 4,
        }}
      >
        Personas
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 18,
          marginTop: 10,
        }}
      >
        <Switch on={enabled} onClick={onToggle} />
        <div>
          <div style={{ color: 'var(--ink)', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
            Show advanced personas
          </div>
          <p style={{ color: 'var(--ink-faint)', fontSize: 12.5, lineHeight: 1.55, margin: 0 }}>
            Reveals five additional roles (Journalist, Commodities, NGO, Citizen, Corporate) in
            every persona dropdown across the platform. Default surface keeps OSINT Analyst and
            Day-Trader visible only.
          </p>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          activeLabel={confirm.activeLabel}
          onSwitchAndHide={onConfirmSwitchAndHide}
          onKeepCurrent={onConfirmKeepCurrent}
        />
      )}
    </section>
  );
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 12,
        background: on ? 'var(--teal)' : 'var(--rule-strong)',
        border: 'none',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 120ms',
        marginTop: 2,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--bg-void)',
          transition: 'left 120ms',
        }}
      />
    </button>
  );
}

function ConfirmDialog({
  activeLabel,
  onSwitchAndHide,
  onKeepCurrent,
}: {
  activeLabel: string;
  onSwitchAndHide: () => void;
  onKeepCurrent: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5, 8, 15, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onKeepCurrent}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 440,
          background: 'var(--bg-panel)',
          border: '1px solid var(--rule-strong)',
          borderRadius: 6,
          padding: '24px 28px',
          color: 'var(--ink)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--amber)',
            marginBottom: 8,
          }}
        >
          Heads up
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 10 }}>
          Hide advanced personas?
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.55, marginBottom: 18 }}>
          Your current persona ({activeLabel}) will become hidden in dropdowns. Switch to OSINT
          Analyst now, or keep the current persona active?
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onKeepCurrent} style={btnGhost}>
            Keep current
          </button>
          <button type="button" onClick={onSwitchAndHide} style={btnPrimary}>
            Switch and hide
          </button>
        </div>
      </div>
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
