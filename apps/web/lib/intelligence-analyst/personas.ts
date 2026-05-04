// ─── Persona overlay (§4.4) ─────────────────────────────────────
// The CONVERSATIONAL_SYSTEM_PROMPT already lists these seven and
// frames responses accordingly when one is named in the context.
// This module exposes them to the UI dropdown and validates the
// `persona` field on chat / rerun route inputs.
//
// Visibility tier (product decision 2026-05-04):
//   • 'default'  — surfaced in every persona dropdown out of the box.
//                  Two personas: analyst, day-trader. These carry the
//                  launch marketing.
//   • 'advanced' — gated behind the eykon.advanced_personas localStorage
//                  flag, flipped by the toggle on /settings. The five
//                  remaining personas. Engineering stays 100% wired —
//                  every server route, the rule evaluator, the chat
//                  prompt overlay, and the suggestion library still
//                  handle all seven personas equally.
//
// Direct URL deep links (?persona=<id>) auto-enable the advanced flag
// for users landing from a case-study page on a gated persona — see
// apps/web/lib/intelligence-analyst/persona-visibility.ts.

export type PersonaVisibility = 'default' | 'advanced';

export const PERSONAS = [
  { id: 'analyst',     label: 'OSINT Analyst', visibility: 'default'  as PersonaVisibility },
  { id: 'day-trader',  label: 'Day-Trader',    visibility: 'default'  as PersonaVisibility },
  { id: 'journalist',  label: 'Journalist',    visibility: 'advanced' as PersonaVisibility },
  { id: 'commodities', label: 'Commodities',   visibility: 'advanced' as PersonaVisibility },
  { id: 'ngo',         label: 'NGO',           visibility: 'advanced' as PersonaVisibility },
  { id: 'citizen',     label: 'Citizen',       visibility: 'advanced' as PersonaVisibility },
  { id: 'corporate',   label: 'Corporate',     visibility: 'advanced' as PersonaVisibility },
] as const;

export type PersonaId = (typeof PERSONAS)[number]['id'];

export const DEFAULT_PERSONA: PersonaId = 'analyst';

const VALID_IDS: ReadonlySet<string> = new Set(PERSONAS.map(p => p.id));

const VISIBILITY_BY_ID: ReadonlyMap<string, PersonaVisibility> = new Map(
  PERSONAS.map(p => [p.id, p.visibility]),
);

export function isValidPersona(value: unknown): value is PersonaId {
  return typeof value === 'string' && VALID_IDS.has(value);
}

export function personaLabel(id: PersonaId | string): string {
  const found = PERSONAS.find(p => p.id === id);
  return found?.label ?? 'OSINT Analyst';
}

export function personaVisibility(id: PersonaId | string): PersonaVisibility {
  return VISIBILITY_BY_ID.get(id) ?? 'advanced';
}

/**
 * Filter the registry to the personas the UI should expose given the
 * current advanced flag. Active persona that is `advanced` while the
 * flag is off is handled by the dropdown component itself — it shows
 * the active label but offers only `default` rows as switch targets.
 */
export function visiblePersonas(advancedEnabled: boolean): typeof PERSONAS[number][] {
  return PERSONAS.filter(p => advancedEnabled || p.visibility === 'default');
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
