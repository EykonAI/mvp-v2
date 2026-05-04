'use client';
import { isValidPersona, personaVisibility, type PersonaId } from './personas';

// Client-side helpers for the "Show advanced personas" gate.
//
// Storage:
//   • eykon.advanced_personas — boolean flag, written by the toggle
//     on /settings and by storage migration.
//   • eykon.persona — active persona id (unchanged from prior PRs).
//
// Cross-tab + cross-component sync: the toggle dispatches a window
// CustomEvent so currently-mounted shells (ChatPanel, NotifShell,
// PersonaContext) re-read without a full page reload.

export const ADVANCED_PERSONAS_STORAGE_KEY = 'eykon.advanced_personas';
export const PERSONA_STORAGE_KEY = 'eykon.persona';
export const ADVANCED_TOGGLE_EVENT = 'eykon:advanced_personas_toggled';

/** Read the current state of the advanced-personas flag from localStorage. */
export function readAdvancedFlag(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ADVANCED_PERSONAS_STORAGE_KEY) === 'true';
}

/** Persist the flag and broadcast to other mounted components. */
export function writeAdvancedFlag(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ADVANCED_PERSONAS_STORAGE_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(
    new CustomEvent(ADVANCED_TOGGLE_EVENT, { detail: { enabled } }),
  );
}

/** Subscribe to flag changes — returns an unsubscribe fn. */
export function subscribeAdvancedFlag(handler: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onEvent = (e: Event) => {
    const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
    handler(detail?.enabled ?? readAdvancedFlag());
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === ADVANCED_PERSONAS_STORAGE_KEY) handler(readAdvancedFlag());
  };
  window.addEventListener(ADVANCED_TOGGLE_EVENT, onEvent);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ADVANCED_TOGGLE_EVENT, onEvent);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Storage migration: if the user has a persisted advanced persona but
 * no flag set, auto-enable the flag so they don't get silently bumped
 * back to OSINT Analyst on first load post-deploy. Returns true when
 * a migration ran (so the caller can fire telemetry once).
 */
export function migrateAdvancedFlagFromActivePersona(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem(PERSONA_STORAGE_KEY);
  if (!isValidPersona(stored)) return false;
  if (personaVisibility(stored) !== 'advanced') return false;
  if (window.localStorage.getItem(ADVANCED_PERSONAS_STORAGE_KEY) !== null) return false;
  writeAdvancedFlag(true);
  return true;
}

/**
 * Resolve a persona from a search-param string. If valid AND advanced,
 * also flip the advanced flag so the dropdown surfaces it for this
 * user from now on. Returns the resolved id or null.
 *
 * Accepts both ?persona=<id> (canonical) and ?p=<id> (legacy alias).
 */
export function resolvePersonaFromSearchParams(
  search: URLSearchParams,
): { persona: PersonaId; auto_enabled_advanced: boolean } | null {
  const raw = search.get('persona') ?? search.get('p');
  if (!isValidPersona(raw)) return null;
  let auto = false;
  if (personaVisibility(raw) === 'advanced' && !readAdvancedFlag()) {
    writeAdvancedFlag(true);
    auto = true;
  }
  return { persona: raw, auto_enabled_advanced: auto };
}
