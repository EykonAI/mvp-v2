'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Persona =
  | 'analyst'
  | 'journalist'
  | 'day-trader'
  | 'commodities'
  | 'ngo'
  | 'citizen'
  | 'corporate';

export const PERSONAS: { slug: Persona; label: string }[] = [
  { slug: 'analyst',     label: 'Analyst' },
  { slug: 'journalist',  label: 'Journalist' },
  { slug: 'day-trader',  label: 'Day Trader' },
  { slug: 'commodities', label: 'Commodities' },
  { slug: 'ngo',         label: 'NGO' },
  { slug: 'citizen',     label: 'Citizen' },
  { slug: 'corporate',   label: 'Corporate' },
];

const STORAGE_KEY = 'eykon.persona';

interface PersonaCtx {
  persona: Persona;
  setPersona: (p: Persona) => void;
}

export const PersonaContext = createContext<PersonaCtx>({
  persona: 'analyst',
  setPersona: () => undefined,
});

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [persona, setPersonaState] = useState<Persona>('analyst');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const urlPersona = url.searchParams.get('p') as Persona | null;
    const stored = (localStorage.getItem(STORAGE_KEY) as Persona | null) ?? null;
    const chosen = urlPersona ?? stored ?? 'analyst';
    if (chosen !== persona) setPersonaState(chosen);
    // Keep URL and storage in sync on first load.
    if (!urlPersona) {
      url.searchParams.set('p', chosen);
      window.history.replaceState({}, '', url.toString());
    }
    localStorage.setItem(STORAGE_KEY, chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPersona = (p: Persona) => {
    setPersonaState(p);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, p);
      const url = new URL(window.location.href);
      url.searchParams.set('p', p);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const value = useMemo(() => ({ persona, setPersona }), [persona]);
  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaCtx {
  return useContext(PersonaContext);
}
