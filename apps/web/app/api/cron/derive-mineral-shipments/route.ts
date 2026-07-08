import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// derive-mineral-shipments · daily cron (Railway: 50 1 * * *).
//
// Derives mineral in-transit shipments from our OWN live AIS layer —
// zero external APIs, zero cost. This is INFERENCE, not cargo
// manifests: we never see what is in the hold. v1 signals are
//   1. vessel class — AIS ship type 70–79 (cargo), and
//   2. the vessel's self-reported AIS destination matching a known
//      mineral trade lane (mineral_route_map dest_keywords), plus
//   3. when available, a port call in the last 21 days at a port
//      matching the lane's origin_keywords (P2a port_calls derivation)
//      — which upgrades the inference from 'destination' to
//      'destination+port_call'.
// Precision improves automatically as port_calls accumulates; today
// that table is young/sparse, so most rows will be destination-only.
//
// Pipeline per tick:
//   1. Load mineral_route_map (seeded by migration 080).
//   2. Fetch cargo vessels (vessel_type 70–79) with a non-empty
//      destination once, match dest_keywords in JS (UPPERCASE
//      substring) — avoids SQL text-array gymnastics.
//   3. Strengthen with recent origin port calls + join dwt from
//      vessel_profiles.
//   4. Upsert into mineral_shipments on (mmsi, mineral, dest_hint);
//      re-observation refreshes last_seen (and revives stale rows).
//   5. Staleness pass: underway rows not re-observed for 7 days
//      become 'stale'.
//
// Auth: Bearer <CRON_SECRET>.

const PORT_CALL_LOOKBACK_DAYS = 21;
const STALE_AFTER_DAYS = 7;
const PAGE_SIZE = 1000;
const IN_CHUNK = 200;

type Route = {
  mineral: string;
  origin_country: string | null;
  origin_keywords: string[] | null;
  dest_keywords: string[] | null;
};

type Vessel = {
  mmsi: string;
  name: string | null;
  flag: string | null;
  destination: string | null;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const errors: string[] = [];

  // 1 ─ Trade lanes
  const { data: routes, error: routesErr } = await supabase
    .from('mineral_route_map')
    .select('mineral, origin_country, origin_keywords, dest_keywords');
  if (routesErr) {
    return NextResponse.json(
      { ok: false, error: routesErr.message, step: 'mineral_route_map' },
      { status: 500 },
    );
  }
  const laneList = (routes ?? []) as Route[];
  if (laneList.length === 0) {
    return NextResponse.json({
      ok: true,
      routes: 0,
      candidates_scanned: 0,
      shipments_upserted: 0,
      stale_marked: 0,
      by_mineral: {},
      errors: ['mineral_route_map is empty — has migration 080 been applied?'],
    });
  }

  // 2 ─ Cargo vessels (AIS type 70–79) with a self-reported destination,
  //     fetched once and keyword-matched in JS.
  const vessels: Vessel[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('vessel_positions')
      .select('mmsi, name, flag, destination')
      .gte('vessel_type', 70)
      .lte('vessel_type', 79)
      .not('destination', 'is', null)
      .neq('destination', '')
      .order('mmsi', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, step: 'vessel_positions' },
        { status: 500 },
      );
    }
    vessels.push(...((data ?? []) as Vessel[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  // Destination-keyword match → candidate (vessel × lane) pairs.
  type Candidate = { vessel: Vessel; route: Route; destHint: string };
  const candidates: Candidate[] = [];
  for (const vessel of vessels) {
    const dest = (vessel.destination ?? '').toUpperCase().trim();
    if (!dest) continue;
    for (const route of laneList) {
      const destKeys = route.dest_keywords ?? [];
      if (destKeys.some((k) => k && dest.includes(k.toUpperCase()))) {
        candidates.push({ vessel, route, destHint: dest });
      }
    }
  }

  const candidateMmsis = Array.from(new Set(candidates.map((c) => c.vessel.mmsi)));

  // 3a ─ Recent port calls for candidates (may be sparse — P2a is young).
  type Call = { mmsi: string; port_name: string | null; arrived_at: string };
  const callsByMmsi = new Map<string, Call[]>();
  if (candidateMmsis.length > 0) {
    const sinceIso = new Date(
      Date.now() - PORT_CALL_LOOKBACK_DAYS * 24 * 3600_000,
    ).toISOString();
    for (const mmsis of chunk(candidateMmsis, IN_CHUNK)) {
      const { data, error } = await supabase
        .from('port_calls')
        .select('mmsi, port_name, arrived_at')
        .in('mmsi', mmsis)
        .gte('arrived_at', sinceIso);
      if (error) {
        errors.push(`port_calls: ${error.message}`);
        break;
      }
      for (const row of (data ?? []) as Call[]) {
        const list = callsByMmsi.get(row.mmsi) ?? [];
        list.push(row);
        callsByMmsi.set(row.mmsi, list);
      }
    }
  }

  // 3b ─ dwt from vessel_profiles.
  const dwtByMmsi = new Map<string, number>();
  if (candidateMmsis.length > 0) {
    for (const mmsis of chunk(candidateMmsis, IN_CHUNK)) {
      const { data, error } = await supabase
        .from('vessel_profiles')
        .select('mmsi, dwt')
        .in('mmsi', mmsis)
        .not('dwt', 'is', null);
      if (error) {
        errors.push(`vessel_profiles: ${error.message}`);
        break;
      }
      for (const row of data ?? []) {
        if (row.dwt != null) dwtByMmsi.set(row.mmsi, Number(row.dwt));
      }
    }
  }

  // 4 ─ Build upsert rows, deduped on the (mmsi, mineral, dest_hint) key
  //     so a single upsert batch never touches the same row twice.
  const nowIso = new Date().toISOString();
  type ShipmentRow = {
    mmsi: string;
    vessel_name: string | null;
    flag: string | null;
    mineral: string;
    origin_port: string | null;
    origin_country: string | null;
    dest_hint: string;
    dwt: number | null;
    inferred_from: string;
    last_seen: string;
    status: string;
  };
  const rowsByKey = new Map<string, ShipmentRow>();
  const byMineral: Record<string, number> = {};

  for (const { vessel, route, destHint } of candidates) {
    // Origin port call in the lookback window matching the lane's
    // origin keywords → higher-confidence inference.
    const originKeys = (route.origin_keywords ?? []).filter(Boolean);
    const calls = callsByMmsi.get(vessel.mmsi) ?? [];
    const originCall = calls.find((c) => {
      const portName = (c.port_name ?? '').toUpperCase();
      return portName && originKeys.some((k) => portName.includes(k.toUpperCase()));
    });

    const row: ShipmentRow = {
      mmsi: vessel.mmsi,
      vessel_name: vessel.name,
      flag: vessel.flag,
      mineral: route.mineral,
      origin_port: originCall?.port_name ?? null,
      origin_country: route.origin_country,
      dest_hint: destHint,
      dwt: dwtByMmsi.get(vessel.mmsi) ?? null,
      inferred_from: originCall ? 'destination+port_call' : 'destination',
      last_seen: nowIso,
      status: 'underway', // re-observation revives a stale row
    };

    const key = `${row.mmsi}|${row.mineral}|${row.dest_hint}`;
    const existing = rowsByKey.get(key);
    // Keep the stronger inference if the same key was built twice.
    if (!existing || (existing.inferred_from === 'destination' && originCall)) {
      if (!existing) byMineral[row.mineral] = (byMineral[row.mineral] ?? 0) + 1;
      rowsByKey.set(key, row);
    }
  }

  let upserted = 0;
  const upsertRows = Array.from(rowsByKey.values());
  for (const batch of chunk(upsertRows, IN_CHUNK)) {
    const { error } = await supabase
      .from('mineral_shipments')
      .upsert(batch, { onConflict: 'mmsi,mineral,dest_hint' });
    if (error) {
      errors.push(`mineral_shipments upsert: ${error.message}`);
      break;
    }
    upserted += batch.length;
  }

  // 5 ─ Staleness pass: underway shipments not re-observed for 7 days.
  const staleCutoff = new Date(
    Date.now() - STALE_AFTER_DAYS * 24 * 3600_000,
  ).toISOString();
  let staleMarked = 0;
  {
    const { data, error } = await supabase
      .from('mineral_shipments')
      .update({ status: 'stale' })
      .eq('status', 'underway')
      .lt('last_seen', staleCutoff)
      .select('mmsi');
    if (error) errors.push(`stale pass: ${error.message}`);
    else staleMarked = data?.length ?? 0;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    routes: laneList.length,
    candidates_scanned: vessels.length,
    shipments_upserted: upserted,
    stale_marked: staleMarked,
    by_mineral: byMineral,
    errors,
  });
}
