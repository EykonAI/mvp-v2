'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  PERSONAS as REGISTRY_PERSONAS,
  DEFAULT_PERSONA,
  isValidPersona,
  personaVisibility,
  type PersonaId,
} from '@/lib/intelligence-analyst/personas';
import {
  PERSONA_STORAGE_KEY,
  migrateAdvancedFlagFromActivePersona,
  resolvePersonaFromSearchParams,
} from '@/lib/intelligence-analyst/persona-visibility';
import { captureBrowser } from '@/lib/analytics/client';

// Backwards-compat alias for any /intel call-site that imports
// `Persona` from this file. The canonical type is PersonaId.
export type Persona = PersonaId;

// Re-export the canonical registry under the legacy { slug, label }
// shape that PersonaSwitcher and intel/dashboard components consume.
// New call-sites should import PERSONAS directly from
// '@/lib/intelligence-analyst/personas'.
export const PERSONAS: { slug: PersonaId; label: string }[] = REGISTRY_PERSONAS.map(p => ({
  slug: p.id,
  label: p.label,
}));

interface PersonaCtx {
  persona: PersonaId;
  setPersona: (p: PersonaId) => void;
}

export const PersonaContext = createContext<PersonaCtx>({
  persona: DEFAULT_PERSONA,
  setPersona: () => undefined,
});

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [persona, setPersonaState] = useState<PersonaId>(DEFAULT_PERSONA);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Existing-user migration: a persisted advanced persona without
    // the new flag means the user predates the toggle — auto-flip
    // the flag so they don't get silently bumped to OSINT Analyst.
    if (migrateAdvancedFlagFromActivePersona()) {
      const stored = window.localStorage.getItem(PERSONA_STORAGE_KEY);
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

    const url = new URL(window.location.href);
    const resolved = resolvePersonaFromSearchParams(url.searchParams);
    const stored = window.localStorage.getItem(PERSONA_STORAGE_KEY);
    const chosen: PersonaId =
      resolved?.persona ?? (isValidPersona(stored) ? stored : DEFAULT_PERSONA);
    if (chosen !== persona) setPersonaState(chosen);

    // Keep URL and storage in sync on first load. Use the canonical
    // ?persona= name; the legacy ?p= alias is read but not written.
    if (!url.searchParams.has('persona') && !url.searchParams.has('p')) {
      url.searchParams.set('persona', chosen);
      window.history.replaceState({}, '', url.toString());
    }
    window.localStorage.setItem(PERSONA_STORAGE_KEY, chosen);

    if (resolved) {
      captureBrowser({
        event: 'persona_changed',
        from: null,
        to: resolved.persona,
        visibility: personaVisibility(resolved.persona),
        source: 'url_param',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPersona = (p: PersonaId) => {
    setPersonaState(prev => {
      if (prev !== p) {
        captureBrowser({
          event: 'persona_changed',
          from: prev,
          to: p,
          visibility: personaVisibility(p),
          source: 'dropdown',
        });
      }
      return p;
    });
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PERSONA_STORAGE_KEY, p);
      const url = new URL(window.location.href);
      url.searchParams.set('persona', p);
      url.searchParams.delete('p');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const value = useMemo(() => ({ persona, setPersona }), [persona]);
  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaCtx {
  return useContext(PersonaContext);
}
