import type { SupabaseClient } from '@supabase/supabase-js';
import { personaLabel, type PersonaId } from '@/lib/intelligence-analyst/personas';

// Zero-config persona digest — data layer (PR 2 of 3).
//
// Builds the content of the daily/weekly digest email from the GLOBAL
// intelligence streams (anomaly_flags, convergence_events,
// infrastructure_events, conflict_events, posture_scores) — NOT from
// user_notification_log: rule fires are per-user and near-empty, while
// the global streams are abundant (thousands of rows/day). Tailoring
// happens by persona, so the send cron (PR 3) is expected to call
// fetchDigestSources() ONCE per cadence window and composeDigest() once
// per persona — never per user.
//
// Persona resolution contract: user_profiles.preferred_persona
// (migration 052) when set, else 'generalist' (union of all domains).
// A NULL persona must never block a digest.

export type DigestPersona = PersonaId | 'generalist';
export type DigestCadence = 'daily' | 'weekly';

export interface DigestConvergence {
  location: string;
  synthesis: string;
  createdAt: string;
}

export interface DigestAnomaly {
  domain: string;
  flagType: string;
  severity: string;
  place: string;       // theatre label or country name — best available
  detectedAt: string;
}

export interface DigestInfraIncident {
  title: string | null;
  country: string;     // human name where known, else raw FIPS code
  eventType: string;   // attack | accident | shutdown
  infraType: string;   // pipeline | refinery | mine | power_plant | other
  severity: string | null;
}

export interface DigestConflict {
  eventType: string;
  country: string;
  fatalities: number;
  eventDate: string;
}

export interface DigestPostureMover {
  theatre: string;
  from: number;
  to: number;
  delta: number;
}

export interface DigestSources {
  windowHours: number;
  sinceIso: string;
  anomalies: Array<{
    domain: string;
    flag_type: string;
    severity: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>;
  convergences: Array<{ location: string | null; synthesis: string | null; created_at: string }>;
  infraEvents: Array<{
    title: string | null;
    country: string | null;
    event_type: string;
    infrastructure_type: string;
    severity: string | null;
    ingested_at: string;
  }>;
  conflictEvents: Array<{
    event_type: string;
    country: string | null;
    fatalities: number | null;
    event_date: string | null;
  }>;
  postureRows: Array<{ theatre_slug: string; composite: number | null; computed_at: string }>;
  errors: string[];
}

export interface DigestData {
  persona: DigestPersona;
  personaLabel: string;
  cadence: DigestCadence;
  windowHours: number;
  convergences: DigestConvergence[];
  anomalies: DigestAnomaly[];
  infraIncidents: DigestInfraIncident[];
  conflictTop: DigestConflict[];
  postureMovers: DigestPostureMover[];
  totals: { anomalies: number; infraIncidents: number; conflictEvents: number };
  isEmpty: boolean;
}

// ─── Persona emphasis ────────────────────────────────────────────
// anomalyDomains/infraTypes null ⇒ no filter (everything). Domains must
// match anomaly_flags.domain values ('Conflict'|'Maritime'|'Energy');
// infraTypes must match infrastructure_events.infrastructure_type
// (migration 045). 'generalist' is the fallback for users with no
// preferred_persona.
const PERSONA_EMPHASIS: Record<DigestPersona, {
  anomalyDomains: string[] | null;
  infraTypes: string[] | null;
}> = {
  analyst:      { anomalyDomains: null,                     infraTypes: null },
  'day-trader': { anomalyDomains: ['Energy', 'Maritime'],   infraTypes: ['refinery', 'pipeline'] },
  journalist:   { anomalyDomains: null,                     infraTypes: null },
  commodities:  { anomalyDomains: ['Maritime', 'Energy'],   infraTypes: ['refinery', 'pipeline', 'mine'] },
  ngo:          { anomalyDomains: ['Conflict'],             infraTypes: ['power_plant'] },
  citizen:      { anomalyDomains: null,                     infraTypes: null },
  corporate:    { anomalyDomains: null,                     infraTypes: null },
  generalist:   { anomalyDomains: null,                     infraTypes: null },
};

// GDELT-derived tables (conflict_events, infrastructure_events) carry
// FIPS 10-4 country codes, not ISO — raw codes are unreadable in an
// email, so map the common ones and fall back to the code itself.
const FIPS_NAMES: Record<string, string> = {
  AF: 'Afghanistan', BM: 'Myanmar', CH: 'China', CO: 'Colombia', EG: 'Egypt',
  GG: 'Georgia', IN: 'India', IR: 'Iran', IS: 'Israel', IZ: 'Iraq',
  KZ: 'Kazakhstan', LE: 'Lebanon', LY: 'Libya', MX: 'Mexico', NI: 'Nigeria',
  PK: 'Pakistan', RS: 'Russia', SA: 'Saudi Arabia', SO: 'Somalia', SU: 'Sudan',
  SY: 'Syria', TU: 'Turkey', TW: 'Taiwan', UK: 'United Kingdom',
  UP: 'Ukraine', US: 'United States', VE: 'Venezuela', YM: 'Yemen',
};

function fipsName(code: string | null | undefined): string | null {
  const c = (code || '').trim().toUpperCase();
  if (!c) return null;
  return FIPS_NAMES[c] ?? c;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
function severityRank(s: string | null | undefined): number {
  return SEVERITY_RANK[(s || '').toLowerCase()] ?? 4;
}

// ─── Fetch (once per cadence window) ─────────────────────────────
// Each query is capped — the caps comfortably exceed observed daily
// volume except infrastructure_events (~1.8k/24h vs cap 600) and
// posture_scores on the weekly window (~3.4k/7d vs cap 2000): both are
// ordered so the cap keeps the most recent rows, which is what the
// digest ranks anyway. Query failures degrade the section to empty and
// are surfaced in `errors` for the cron to log — a digest with a
// missing section beats no digest.
export async function fetchDigestSources(
  supabase: SupabaseClient,
  windowHours: number,
): Promise<DigestSources> {
  const sinceIso = new Date(Date.now() - windowHours * 3600_000).toISOString();
  const errors: string[] = [];

  const [anomaliesRes, convergencesRes, infraRes, conflictRes, postureRes] = await Promise.all([
    supabase
      .from('anomaly_flags')
      .select('domain, flag_type, severity, payload, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(400),
    supabase
      .from('convergence_events')
      .select('location, synthesis, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('infrastructure_events')
      .select('title, country, event_type, infrastructure_type, severity, ingested_at')
      .gte('ingested_at', sinceIso)
      .order('ingested_at', { ascending: false })
      .limit(600),
    supabase
      .from('conflict_events')
      .select('event_type, country, fatalities, event_date')
      .gte('ingested_at', sinceIso)
      .order('fatalities', { ascending: false })
      .limit(60),
    supabase
      .from('posture_scores')
      .select('theatre_slug, composite, computed_at')
      .gte('computed_at', sinceIso)
      .order('computed_at', { ascending: false })
      .limit(2000),
  ]);

  if (anomaliesRes.error) errors.push(`anomaly_flags: ${anomaliesRes.error.message}`);
  if (convergencesRes.error) errors.push(`convergence_events: ${convergencesRes.error.message}`);
  if (infraRes.error) errors.push(`infrastructure_events: ${infraRes.error.message}`);
  if (conflictRes.error) errors.push(`conflict_events: ${conflictRes.error.message}`);
  if (postureRes.error) errors.push(`posture_scores: ${postureRes.error.message}`);

  return {
    windowHours,
    sinceIso,
    anomalies: (anomaliesRes.data as DigestSources['anomalies'] | null) ?? [],
    convergences: (convergencesRes.data as DigestSources['convergences'] | null) ?? [],
    infraEvents: (infraRes.data as DigestSources['infraEvents'] | null) ?? [],
    conflictEvents: (conflictRes.data as DigestSources['conflictEvents'] | null) ?? [],
    postureRows: (postureRes.data as DigestSources['postureRows'] | null) ?? [],
    errors,
  };
}

// ─── Compose (once per persona) ──────────────────────────────────
export function composeDigest(
  sources: DigestSources,
  persona: DigestPersona,
  cadence: DigestCadence,
): DigestData {
  const emphasis = PERSONA_EMPHASIS[persona] ?? PERSONA_EMPHASIS.generalist;

  // Convergences are rare, cross-domain, and relevant to every persona —
  // never filtered.
  const convergences: DigestConvergence[] = sources.convergences
    .filter(c => (c.synthesis || '').trim().length > 0)
    .slice(0, 3)
    .map(c => ({
      location: c.location ?? '—',
      synthesis: (c.synthesis || '').trim(),
      createdAt: c.created_at,
    }));

  const anomaliesFiltered = sources.anomalies.filter(
    a => !emphasis.anomalyDomains || emphasis.anomalyDomains.includes(a.domain),
  );
  const anomalies: DigestAnomaly[] = [...anomaliesFiltered]
    .sort((a, b) =>
      severityRank(a.severity) - severityRank(b.severity)
      || b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map(a => {
      const p = a.payload ?? {};
      const place =
        (typeof p.theatre_label === 'string' && p.theatre_label) ||
        fipsName(typeof p.country === 'string' ? p.country : null) ||
        '—';
      return {
        domain: a.domain,
        flagType: a.flag_type,
        severity: (a.severity || 'low').toLowerCase(),
        place,
        detectedAt: a.created_at,
      };
    });

  // GKG syndicates one story across many records — dedupe on the
  // headline so the digest lists incidents, not copies.
  const infraFiltered = sources.infraEvents.filter(
    e => !emphasis.infraTypes || emphasis.infraTypes.includes(e.infrastructure_type),
  );
  const seenTitles = new Set<string>();
  const infraDeduped = infraFiltered.filter(e => {
    const key = (e.title || '').trim().toLowerCase();
    if (!key) return true;
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });
  const infraIncidents: DigestInfraIncident[] = [...infraDeduped]
    .sort((a, b) =>
      severityRank(a.severity) - severityRank(b.severity)
      || b.ingested_at.localeCompare(a.ingested_at))
    .slice(0, 6)
    .map(e => ({
      title: e.title,
      country: fipsName(e.country) ?? '—',
      eventType: e.event_type,
      infraType: e.infrastructure_type,
      severity: e.severity,
    }));

  // Already fatalities-desc from the fetch; keep the top of the window.
  const conflictTop: DigestConflict[] = sources.conflictEvents.slice(0, 5).map(e => ({
    eventType: e.event_type,
    country: fipsName(e.country) ?? '—',
    fatalities: e.fatalities ?? 0,
    eventDate: e.event_date ?? '',
  }));

  // Posture movers: earliest vs latest composite per theatre inside the
  // window. Rows arrive newest-first, so first-seen = `to` and the last
  // row seen per theatre = `from`. Theatres with a single datapoint
  // can't move and are dropped.
  const postureByTheatre = new Map<string, { to: number; toAt: string; from: number; points: number }>();
  for (const row of sources.postureRows) {
    if (typeof row.composite !== 'number') continue;
    const existing = postureByTheatre.get(row.theatre_slug);
    if (!existing) {
      postureByTheatre.set(row.theatre_slug, {
        to: row.composite, toAt: row.computed_at, from: row.composite, points: 1,
      });
    } else {
      existing.from = row.composite; // keeps updating until the oldest row wins
      existing.points += 1;
    }
  }
  const postureMovers: DigestPostureMover[] = [...postureByTheatre.entries()]
    .filter(([, v]) => v.points >= 2)
    .map(([theatre, v]) => ({
      theatre,
      from: Math.round(v.from * 1000) / 1000,
      to: Math.round(v.to * 1000) / 1000,
      delta: Math.round((v.to - v.from) * 1000) / 1000,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  // Posture always has rows (hourly cron), so it deliberately does NOT
  // count toward emptiness — an "empty" digest is one with no events.
  const totals = {
    anomalies: anomaliesFiltered.length,
    infraIncidents: infraDeduped.length,
    conflictEvents: sources.conflictEvents.length,
  };
  const isEmpty =
    convergences.length === 0 &&
    anomalies.length === 0 &&
    infraIncidents.length === 0 &&
    conflictTop.length === 0;

  return {
    persona,
    personaLabel: persona === 'generalist' ? 'Intelligence overview' : personaLabel(persona),
    cadence,
    windowHours: sources.windowHours,
    convergences,
    anomalies,
    infraIncidents,
    conflictTop,
    postureMovers,
    totals,
    isEmpty,
  };
}

// Subject line: lead with the rarest signal present.
export function digestSubject(data: DigestData): string {
  const cadenceWord = data.cadence === 'daily' ? 'Daily' : 'Weekly';
  const bits: string[] = [];
  if (data.convergences.length > 0) {
    bits.push(`${data.convergences.length} convergence${data.convergences.length > 1 ? 's' : ''}`);
  }
  if (data.totals.anomalies > 0) {
    bits.push(`${data.totals.anomalies} anomaly flag${data.totals.anomalies > 1 ? 's' : ''}`);
  }
  if (bits.length === 0 && data.totals.infraIncidents > 0) {
    bits.push(`${data.totals.infraIncidents} infrastructure incidents`);
  }
  const headline = bits.length > 0 ? bits.slice(0, 2).join(', ') : 'quiet period';
  return `eYKON ${cadenceWord} Digest — ${headline}`;
}
