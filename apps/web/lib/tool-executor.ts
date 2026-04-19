// ─── Tool Executor: resolves Claude tool calls against live data ───
import { createServerSupabase } from './supabase-server';
import { simulateChokepoint } from './intel/chokepoint';
import { runWargame } from './intel/sanctions';

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function executeToolCall(toolName: string, toolInput: Record<string, any>): Promise<string> {
  try {
    switch (toolName) {
      // Core live-data
      case 'query_vessels':             return await queryVessels(toolInput);
      case 'query_aircraft':            return await queryAircraft(toolInput);
      case 'query_conflicts':           return await queryConflicts(toolInput);
      case 'query_infrastructure':      return await queryInfrastructure(toolInput);
      case 'query_weather':             return await queryWeather(toolInput);
      case 'query_agent_reports':       return await queryAgentReports(toolInput);

      // Intelligence Center
      case 'query_posture_scores':      return await queryPosture(toolInput);
      case 'query_convergences':        return await queryConvergences(toolInput);
      case 'query_shadow_fleet_leads':  return await queryShadowFleetLeads(toolInput);
      case 'query_calibration':         return await queryCalibration(toolInput);
      case 'query_precursor_matches':   return await queryPrecursorMatches(toolInput);
      case 'run_chokepoint_scenario':   return await runChokepointScenario(toolInput);
      case 'run_sanctions_wargame':     return await runSanctionsWargameTool(toolInput);
      case 'query_regime_shifts':       return await queryRegimeShiftsTool(toolInput);
      case 'query_entities':            return await queryEntities(toolInput);
      case 'expand_actor_network':      return await expandActorNetwork(toolInput);

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err?.message ?? 'unknown' });
  }
}

async function queryVessels(input: Record<string, any>): Promise<string> {
  const { lat_min, lat_max, lon_min, lon_max } = input;
  const res = await fetch(
    `${APP_URL()}/api/vessels?latmin=${lat_min}&latmax=${lat_max}&lonmin=${lon_min}&lonmax=${lon_max}`,
  );
  const data = await res.json();
  const vessels = (data.data || data || []).slice(0, 50);
  return JSON.stringify({
    count: vessels.length,
    vessels: vessels.map((v: any) => ({
      name: v.NAME || v.name || 'Unknown',
      mmsi: v.MMSI || v.mmsi,
      type: v.TYPE || v.type,
      lat: v.LATITUDE || v.latitude,
      lon: v.LONGITUDE || v.longitude,
      speed: v.SOG || v.speed,
      heading: v.HEADING || v.heading,
      destination: v.DESTINATION || v.destination,
    })),
  });
}

async function queryAircraft(input: Record<string, any>): Promise<string> {
  const { lat_min, lat_max, lon_min, lon_max, altitude_min, altitude_max } = input;
  const res = await fetch(
    `${APP_URL()}/api/aircraft?lat_min=${lat_min}&lat_max=${lat_max}&lon_min=${lon_min}&lon_max=${lon_max}`,
  );
  const data = await res.json();
  let aircraft = (data.data || data || []).slice(0, 50);
  if (altitude_min !== undefined) aircraft = aircraft.filter((a: any) => (a.altitude || a.alt_baro || 0) >= altitude_min);
  if (altitude_max !== undefined) aircraft = aircraft.filter((a: any) => (a.altitude || a.alt_baro || 0) <= altitude_max);
  return JSON.stringify({
    count: aircraft.length,
    aircraft: aircraft.map((a: any) => ({
      callsign: a.callsign || a.flight || a.icao24 || 'Unknown',
      icao24: a.icao24 || a.hex,
      lat: a.latitude || a.lat,
      lon: a.longitude || a.lon,
      altitude_m: a.altitude || a.alt_baro,
      velocity_kts: a.velocity ? Math.round(a.velocity * 1.944) : a.gs,
      heading: a.heading || a.track,
      country: a.country || a.origin_country,
      on_ground: a.on_ground || a.alt_baro === 'ground',
    })),
  });
}

async function queryConflicts(input: Record<string, any>): Promise<string> {
  const params = new URLSearchParams();
  if (input.country) params.set('country', input.country);
  if (input.days) params.set('days', String(input.days));
  if (input.event_type) params.set('event_type', input.event_type);
  if (input.lat_min !== undefined) {
    params.set('lat_min', String(input.lat_min));
    params.set('lat_max', String(input.lat_max));
    params.set('lon_min', String(input.lon_min));
    params.set('lon_max', String(input.lon_max));
  }
  const res = await fetch(`${APP_URL()}/api/conflicts?${params.toString()}`);
  const data = await res.json();
  const events = (data.data || data || []).slice(0, 50);
  return JSON.stringify({
    count: events.length,
    events: events.map((e: any) => ({
      type: e.event_type,
      country: e.country,
      date: e.event_date,
      lat: parseFloat(e.latitude),
      lon: parseFloat(e.longitude),
      actor1: e.actor1,
      actor2: e.actor2,
      fatalities: parseInt(e.fatalities) || 0,
      notes: (e.notes || '').substring(0, 200),
    })),
  });
}

async function queryInfrastructure(input: Record<string, any>): Promise<string> {
  const params = new URLSearchParams({
    lat_min: String(input.lat_min),
    lat_max: String(input.lat_max),
    lon_min: String(input.lon_min),
    lon_max: String(input.lon_max),
  });
  if (input.fuel_type) params.set('fuel_type', input.fuel_type);
  const res = await fetch(`${APP_URL()}/api/infrastructure?${params.toString()}`);
  const data = await res.json();
  const items = (data.data || data || []).slice(0, 50);
  return JSON.stringify({ count: items.length, facilities: items });
}

async function queryWeather(input: Record<string, any>): Promise<string> {
  const { latitude, longitude } = input;
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code&timezone=auto`,
  );
  const data = await res.json();
  return JSON.stringify({
    location: { lat: latitude, lon: longitude },
    current: data.current || {},
    units: data.current_units || {},
  });
}

async function queryAgentReports(input: Record<string, any>): Promise<string> {
  try {
    const supabase = createServerSupabase();
    const hours = input.hours || 48;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    let query = supabase
      .from('agent_reports')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    if (input.domain) query = query.eq('domain', input.domain);
    if (input.severity) {
      const levels = ['low', 'medium', 'high', 'critical'];
      const minIdx = levels.indexOf(input.severity);
      if (minIdx >= 0) query = query.in('severity', levels.slice(minIdx));
    }
    const { data, error } = await query;
    if (error) return JSON.stringify({ count: 0, reports: [], note: 'Agent reports table not yet populated' });
    return JSON.stringify({ count: (data || []).length, reports: data || [] });
  } catch {
    return JSON.stringify({ count: 0, reports: [], note: 'Agent reports not yet available' });
  }
}

// ─── Intelligence Center tools ─────────────────────────────────

async function queryPosture(input: Record<string, any>): Promise<string> {
  const res = await fetch(`${APP_URL()}/api/intel/posture`);
  const j = await res.json();
  const theatres: any[] = j.theatres ?? [];
  const filtered = input.theatre_slug ? theatres.filter(t => t.slug === input.theatre_slug) : theatres;
  const limit = Math.min(50, Math.max(1, Number(input.limit ?? 10)));
  return JSON.stringify({ count: filtered.length, theatres: filtered.slice(0, limit), live: j.live ?? false });
}

async function queryConvergences(input: Record<string, any>): Promise<string> {
  const hours = Number(input.hours ?? 24);
  const res = await fetch(`${APP_URL()}/api/intel/convergences?hours=${hours}`);
  const j = await res.json();
  return JSON.stringify({ count: (j.events ?? []).length, events: j.events ?? [], degraded: j.degraded ?? false });
}

async function queryShadowFleetLeads(input: Record<string, any>): Promise<string> {
  const params = new URLSearchParams();
  if (input.commodity) params.set('commodity', String(input.commodity));
  if (input.min_score !== undefined) params.set('min_score', String(input.min_score));
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  const res = await fetch(`${APP_URL()}/api/intel/shadow-fleet/leads?${params.toString()}`);
  const j = await res.json();
  return JSON.stringify({ count: (j.leads ?? []).length, leads: j.leads ?? [], live: j.live ?? false });
}

async function queryCalibration(input: Record<string, any>): Promise<string> {
  try {
    const supabase = createServerSupabase();
    const feature = input.feature as string | undefined;
    const windowDays = Number(input.window_days ?? 30);
    const since = new Date(Date.now() - windowDays * 24 * 3600_000).toISOString();
    let q = supabase
      .from('prediction_outcomes')
      .select('brier, log_loss, calibration_bin, observed_at, predictions_register!inner(feature, persona)')
      .gte('observed_at', since)
      .limit(5000);
    if (feature) q = q.eq('predictions_register.feature', feature);
    const { data } = await q;
    const briers = (data ?? []).map((r: any) => Number(r.brier)).filter(Number.isFinite);
    const logLosses = (data ?? []).map((r: any) => Number(r.log_loss)).filter(Number.isFinite);
    return JSON.stringify({
      feature: feature ?? 'all',
      window_days: windowDays,
      count: briers.length,
      avg_brier: briers.length ? briers.reduce((a, b) => a + b, 0) / briers.length : null,
      avg_log_loss: logLosses.length ? logLosses.reduce((a, b) => a + b, 0) / logLosses.length : null,
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message, note: 'Predictions register is likely warming up.' });
  }
}

async function queryPrecursorMatches(input: Record<string, any>): Promise<string> {
  const res = await fetch(`${APP_URL()}/api/intel/precursor/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theatre_slug: input.theatre_slug, top_k: input.top_k ?? 3, event_type: input.event_type }),
  });
  const j = await res.json();
  return JSON.stringify(j);
}

async function runChokepointScenario(input: Record<string, any>): Promise<string> {
  try {
    const output = simulateChokepoint({
      chokepoint: input.chokepoint,
      closure_type: input.closure_type,
      duration_days: Number(input.duration_days),
      diversion_lag_hours: Number(input.diversion_lag_hours ?? 48),
      assumptions: input.assumptions ?? {},
    });
    return JSON.stringify({
      consequence_summary: output.consequence_summary,
      diverted_vessels: output.diverted_vessels,
      refining_impact_kbd: output.refining_impact_kbd,
      timeline: output.timeline,
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function runSanctionsWargameTool(input: Record<string, any>): Promise<string> {
  try {
    const output = runWargame({
      sanctioning_bodies: input.sanctioning_bodies,
      preset: input.preset,
      target_entities: input.target_entities,
      depth: (input.depth ?? 2) as 1 | 2 | 3,
    });
    return JSON.stringify({
      fleet_scope: output.fleet_scope,
      top_affected: output.top_affected,
      reflag_destinations: output.reflag_destinations,
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function queryRegimeShiftsTool(input: Record<string, any>): Promise<string> {
  const res = await fetch(`${APP_URL()}/api/intel/regime-shifts`);
  const j = await res.json();
  const regions: any[] = j.regions ?? [];
  const filtered = input.region ? regions.filter(r => r.region.toLowerCase().includes(String(input.region).toLowerCase())) : regions;
  return JSON.stringify({ count: filtered.length, regions: filtered });
}

async function queryEntities(input: Record<string, any>): Promise<string> {
  try {
    const supabase = createServerSupabase();
    let q = supabase
      .from('entities')
      .select('id, entity_type, canonical_name, aliases, metadata')
      .ilike('canonical_name', `%${String(input.q ?? '')}%`)
      .limit(Math.min(50, Math.max(1, Number(input.limit ?? 20))));
    if (input.entity_type) q = q.eq('entity_type', input.entity_type);
    const { data } = await q;
    return JSON.stringify({ count: (data ?? []).length, entities: data ?? [] });
  } catch (err: any) {
    return JSON.stringify({ error: err.message, count: 0, entities: [] });
  }
}

async function expandActorNetwork(input: Record<string, any>): Promise<string> {
  try {
    const supabase = createServerSupabase();
    const seedId = String(input.entity_id);
    const hops = Math.min(3, Math.max(1, Number(input.hops ?? 2)));

    const nodes = new Map<string, any>();
    const edges: any[] = [];
    const frontier = new Set<string>([seedId]);

    for (let h = 0; h < hops; h++) {
      if (frontier.size === 0) break;
      const ids = Array.from(frontier);
      const { data: found } = await supabase.from('entities').select('id, canonical_name, entity_type').in('id', ids);
      for (const f of found ?? []) nodes.set(f.id, { ...f, ring: h });

      const { data: out } = await supabase
        .from('fleet_kinship_edges')
        .select('source_entity_id, target_entity_id, edge_type, weight')
        .in('source_entity_id', ids)
        .limit(500);

      const nextFrontier = new Set<string>();
      for (const e of out ?? []) {
        edges.push(e);
        if (!nodes.has(e.target_entity_id)) nextFrontier.add(e.target_entity_id);
      }
      frontier.clear();
      for (const n of nextFrontier) frontier.add(n);
    }

    return JSON.stringify({ seed: seedId, hops, nodes: Array.from(nodes.values()), edges });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}
