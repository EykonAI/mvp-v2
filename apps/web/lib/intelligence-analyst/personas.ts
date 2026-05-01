// ─── Persona overlay (§4.4) ─────────────────────────────────────
// The CONVERSATIONAL_SYSTEM_PROMPT already lists these seven and
// frames responses accordingly when one is named in the context.
// This module exposes them to the UI dropdown and validates the
// `persona` field on chat / rerun route inputs.

export const PERSONAS = [
  { id: 'analyst',     label: 'Analyst' },
  { id: 'journalist',  label: 'Journalist' },
  { id: 'day-trader',  label: 'Day-trader' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'ngo',         label: 'NGO' },
  { id: 'citizen',     label: 'Citizen' },
  { id: 'corporate',   label: 'Corporate' },
] as const;

export type PersonaId = (typeof PERSONAS)[number]['id'];

export const DEFAULT_PERSONA: PersonaId = 'analyst';

const VALID_IDS: ReadonlySet<string> = new Set(PERSONAS.map(p => p.id));

export function isValidPersona(value: unknown): value is PersonaId {
  return typeof value === 'string' && VALID_IDS.has(value);
}

export function personaLabel(id: PersonaId | string): string {
  const found = PERSONAS.find(p => p.id === id);
  return found?.label ?? 'Analyst';
}

/**
 * Append a single sentence to the system prompt naming the active
 * persona. The base prompt already says "if the context names a
 * persona, frame accordingly", so this is the trigger.
 */
export function decorateSystemPrompt(base: string, persona: PersonaId | undefined): string {
  if (!persona) return base;
  return `${base}\n\nActive persona: ${persona}. Frame the response for this audience.`;
}
