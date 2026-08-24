import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { boxForPosition, boxState, type BoxLiveness } from '@/lib/intel/aisCoverage';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Aerial contacts for the Dark Contact Board — the AIR observation domain.
 *
 * DELIBERATELY NOT SCORED. The maritime confidence model ranks silence
 * against a vessel's own cadence baseline; no aircraft_position_history
 * exists, so no aerial baseline is derivable — and an aircraft that stops
 * transmitting has usually LANDED, which is not anomalous. Scoring aerial
 * silence would fabricate exactly the signal class this workspace removed.
 * Aerial contacts carry a last-seen recency, an anomaly tag set, and nothing
 * dressed as a probability.
 *
 * Why the domain exists at all: coverage complementarity. When an AIS box is
 * dead, ADS-B is the remaining sensor over the same water — measured today,
 * 33 military tracks inside the Hormuz box during 22 days of AIS silence.
 * Contacts inside a dead AIS box carry ais_blind_here: true.
 *
 * Column caveat carried from the worker (PR #132): aircraft_positions.country
 * holds the REGISTRATION string (34,717 distinct values), not a country.
 * It is exposed here as `registration` and must be labelled Registration in
 * every UI. ingested_at is a true last-seen (the ADS-B worker refreshes it on
 * every upsert), unlike the vessel table's two-column trap.
 */

const WINDOW_H = 48;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200)));

  try {
    const supabase = createServerSupabase();
    const since = new Date(Date.now() - WINDOW_H * 3600_000).toISOString();

    const [mil, squawk, clock, liveness] = await Promise.all([
      supabase
        .from('aircraft_positions')
        .select('icao24, callsign, type, military, country, squawk, latitude, longitude, altitude, velocity, heading, on_ground, ingested_at')
        .eq('military', true)
        .gte('ingested_at', since)
        .order('ingested_at', { ascending: false })
        .limit(limit),
      supabase
        .from('aircraft_positions')
        .select('icao24, callsign, type, military, country, squawk, latitude, longitude, altitude, velocity, heading, on_ground, ingested_at')
        .in('squawk', ['7500', '7600', '7700'])
        .gte('ingested_at', since)
        .limit(50),
      supabase
        .from('aircraft_positions')
        .select('ingested_at')
        .order('ingested_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('ais_box_liveness').select('*'),
    ]);

    const livenessMap = new Map<string, BoxLiveness>(
      ((liveness.data ?? []) as BoxLiveness[]).map(r => [r.slug, r]),
    );

    const airClockMs = clock.data?.ingested_at
      ? new Date(clock.data.ingested_at).getTime()
      : Date.now();

    const byIcao = new Map<string, any>();
    for (const a of [...(squawk.data ?? []), ...(mil.data ?? [])]) {
      if (!byIcao.has(a.icao24)) byIcao.set(a.icao24, a);
    }

    const contacts = Array.from(byIcao.values()).map((a: any) => {
      const box = boxForPosition(a.latitude, a.longitude);
      const aisBlindHere = box ? boxState(livenessMap.get(box.slug)) === 'dead' : false;
      const seenH = Math.max(0, (airClockMs - new Date(a.ingested_at).getTime()) / 3600_000);
      const tags: string[] = [];
      if (a.military) tags.push('military');
      if (['7500', '7600', '7700'].includes(a.squawk ?? '')) tags.push(`squawk_${a.squawk}`);
      if (!a.callsign || !String(a.callsign).trim()) tags.push('no_callsign');
      if (aisBlindHere) tags.push('ais_blind_here');
      return {
        icao24: a.icao24,
        callsign: a.callsign?.trim() || null,
        type: a.type ?? null,
        // country column holds the registration string — see header comment.
        registration: a.country ?? null,
        squawk: a.squawk ?? null,
        latitude: a.latitude,
        longitude: a.longitude,
        altitude_ft: a.altitude ?? null,
        velocity_kn: a.velocity ?? null,
        on_ground: a.on_ground ?? null,
        last_seen_at: a.ingested_at,
        last_seen_hours: Math.round(seenH * 10) / 10,
        box_slug: box?.slug ?? null,
        ais_blind_here: aisBlindHere,
        tags,
      };
    });

    contacts.sort((x, y) => {
      // AIS-blind-box contacts first (the cross-domain moment), then freshest.
      if (x.ais_blind_here !== y.ais_blind_here) return x.ais_blind_here ? -1 : 1;
      return x.last_seen_hours - y.last_seen_hours;
    });

    return NextResponse.json({
      contacts: contacts.slice(0, limit),
      window_hours: WINDOW_H,
      air_clock: new Date(airClockMs).toISOString(),
      note: 'Aerial contacts are OBSERVED ACTIVITY, not scored: no aerial cadence baseline exists, and a quiet transponder usually means a landed aircraft. last_seen_hours is recency, not a dark-gap.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ contacts: [], error: message }, { status: 200 });
  }
}
