import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';

// detect-anomalies-energy · hourly cron.
//
// Third writer to anomaly_flags, after detect-anomalies-conflict and
// detect-anomalies-maritime. Those two count rows inside the five
// maritime-chokepoint theatres of posture_seed; the energy domain is
// COUNTRY-distributed instead: Russian refinery strikes, Nigerian
// inland pipeline sabotage and US grid outages nearly all fall OUTSIDE
// those chokepoint bboxes, so a theatre-bbox model would miss them.
// This detector groups the GDELT-derived infrastructure_events stream
// (PR 2, migration 045) by FIPS-10-4 country over the last hour and
// flags any country with a burst of incidents.
//
// Two deliberate deviations from the conflict/maritime siblings:
//   1. Per-country grouping, not theatre-bbox (rationale above).
//   2. Absolute threshold, not mean+2σ. infrastructure_events has no
//      learned baseline in baseline_distributions (compute-baselines
//      buckets vessel/ACLED rows by theatre, not energy rows by
//      country), so there is no μ/σ to test against — we gate on a raw
//      count floor instead.
//
// Precision-first (the posture chosen for PR 2): GKG syndicates one
// story across many records, so a raw row-count can be inflated by
// copies of a SINGLE incident. We therefore require the window's events
// to span at least MIN_DISTINCT distinct headlines before flagging, and
// key severity on the distinct-headline count — a lone story syndicated
// N times either stays under the gate or, if it clears FLOOR on raw
// count alone, is reported as 'syndication_only' and NOT flagged.
//
// Representative lat/lon (mean of the country's geocoded events) is
// written into the payload so compute-convergences can bin this flag
// into its 5°×5° cells alongside Conflict/Maritime flags.
//
// Auth: Bearer <CRON_SECRET> via requireCronSecret (header-only — the
// ?secret= query form is NOT accepted).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const WINDOW_HOURS = 1;       // tiles cleanly with an hourly (0 * * * *) cron
const FETCH_LIMIT = 2000;     // bound the scan; the stream is sparse
const FLOOR = 3;              // min raw events in the window for a country
const MIN_DISTINCT = 2;       // ...spanning ≥ this many distinct headlines
const HIGH_DISTINCT = 3;      // severity='high' at/above this many headlines

interface InfraEventRow {
  country: string | null;
  infrastructure_type: string | null;
  event_type: string | null;
  severity: string | null;
  tone: number | string | null;
  title: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

type DetectionState =
  | { state: 'fired'; country: string; count: number; distinct_titles: number; severity: string }
  | { state: 'syndication_only'; country: string; count: number; distinct_titles: number }
  | { state: 'error'; country: string; error: string };

function finite(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function tally(values: Array<string | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = (v || '').trim();
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const sinceIso = new Date(now.getTime() - WINDOW_HOURS * 3600_000).toISOString();

  // Pull this window's attributable energy-infra events. country is
  // FIPS 10-4; the .not(country, is, null) filter drops the rows the
  // ingest could not geolocate to a country.
  const { data, error } = await supabase
    .from('infrastructure_events')
    .select('country, infrastructure_type, event_type, severity, tone, title, latitude, longitude')
    .gte('ingested_at', sinceIso)
    .not('country', 'is', null)
    .order('ingested_at', { ascending: false })
    .limit(FETCH_LIMIT);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Group by country.
  const byCountry = new Map<string, InfraEventRow[]>();
  for (const row of (data as InfraEventRow[] | null) ?? []) {
    const c = (row.country || '').trim();
    if (!c) continue;
    if (!byCountry.has(c)) byCountry.set(c, []);
    byCountry.get(c)!.push(row);
  }

  const results: DetectionState[] = [];
  let belowFloor = 0;

  for (const [country, rows] of byCountry) {
    const count = rows.length;
    if (count < FLOOR) {
      belowFloor += 1;
      continue;
    }

    // Distinct headlines collapse syndicated copies of one story.
    const titles = rows.map(r => (r.title || '').trim()).filter(Boolean);
    const distinctTitles = new Set(titles);
    const distinctCount = distinctTitles.size;

    if (distinctCount < MIN_DISTINCT) {
      // Cleared the raw floor but it is (almost certainly) one incident
      // syndicated — do not flag, but surface it for diagnostics.
      results.push({ state: 'syndication_only', country, count, distinct_titles: distinctCount });
      continue;
    }

    // Representative point: mean of the geocoded events in this country.
    const lats = rows.map(r => finite(r.latitude)).filter((n): n is number => n !== null);
    const lons = rows.map(r => finite(r.longitude)).filter((n): n is number => n !== null);
    const repLat = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : null;
    const repLon = lons.length ? lons.reduce((a, b) => a + b, 0) / lons.length : null;

    // Tone is negative for adverse coverage; the most adverse is the min.
    const tones = rows.map(r => finite(r.tone)).filter((n): n is number => n !== null);
    const mostAdverseTone = tones.length ? Math.min(...tones) : null;

    const severity = distinctCount >= HIGH_DISTINCT ? 'high' : 'medium';

    const { error: insertErr } = await supabase.from('anomaly_flags').insert({
      source: 'energy_anomaly_detector_v1',
      domain: 'Energy',
      flag_type: 'infra_event_count_threshold',
      severity,
      payload: {
        country,
        window_hours: WINDOW_HOURS,
        current_count: count,
        distinct_titles: distinctCount,
        floor: FLOOR,
        latitude: repLat,
        longitude: repLon,
        by_infrastructure_type: tally(rows.map(r => r.infrastructure_type)),
        by_event_type: tally(rows.map(r => r.event_type)),
        sample_titles: Array.from(distinctTitles).slice(0, 3),
        most_adverse_tone: mostAdverseTone,
        detected_at: now.toISOString(),
      },
    });

    if (insertErr) {
      results.push({ state: 'error', country, error: insertErr.message });
      continue;
    }
    results.push({ state: 'fired', country, count, distinct_titles: distinctCount, severity });
  }

  return NextResponse.json({
    tickStartedAt: now.toISOString(),
    window_hours: WINDOW_HOURS,
    floor: FLOOR,
    min_distinct: MIN_DISTINCT,
    countries_seen: byCountry.size,
    fired: results.filter(r => r.state === 'fired').length,
    syndication_only: results.filter(r => r.state === 'syndication_only').length,
    below_floor: belowFloor,
    errors: results.filter(r => r.state === 'error').length,
    results,
  });
}
