// ─── Curated empty-state starter queries (§4.5) ──────────────────
// Six prompts grouped by three personas, shown to first-time users
// when the Query History tab is empty. Each persona includes at
// least one cross-data prompt — teaches the platform's "think
// across feeds" value early.

export interface StarterPersona {
  id: string;
  label: string;
  blurb: string;
  prompts: readonly string[];
}

export const STARTER_PERSONAS: readonly StarterPersona[] = [
  {
    id: 'energy',
    label: 'Energy analyst',
    blurb: 'Refineries, pipelines, power plants — and how they intersect with conflict and weather.',
    prompts: [
      'Operating refineries in Saudi Arabia with capacity > 200,000 bpd',
      'Tanker traffic near Saudi refinery export terminals in the last 7 days',
    ],
  },
  {
    id: 'maritime',
    label: 'Maritime risk professional',
    blurb: 'Vessels, ports, chokepoints — overlaid with conflict events and shadow-fleet leads.',
    prompts: [
      'Vessels currently transiting the Strait of Hormuz',
      'Shadow-fleet leads in the Black Sea with AIS gaps over 12 hours',
    ],
  },
  {
    id: 'journalist',
    label: 'Journalist',
    blurb: 'Conflict events, infrastructure, and weather — sourced and timestamped.',
    prompts: [
      'Conflict events in West Africa in the last 30 days',
      'Power plants offline in regions under storm warnings',
    ],
  },
];
