// ─── Tool Executor: resolves Claude tool calls against live data ───
import { createServerSupabase } from './supabase-server';

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, any>
): Promise<string> {
  try {
    switch (toolName) {
      case 'query_vessels':
        return await queryVessels(toolInput);
      case 'query_aircraft':
        return await queryAircraft(toolInput);
      case 'query_conflicts':
        return await queryConflicts(toolInput);
      case 'query_infrastructure':
        return await queryInfrastructure(toolInput);
      case 'query_weather':
        return await queryWeather(toolInput);
      case 'query_agent_reports':
        return await queryAgentReports(toolInput);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function queryVessels(input: Record<string, any>): Promise<string> {
  const { lat_min, lat_max, lon_min, lon_max } = input;
  // Query the live vessels API
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/vessels?latmin=${lat_min}&latmax=${lat_max}&lonmin=${lon_min}&lonmax=${lon_max}`
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
    `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/aircraft?lat_min=${lat_min}&lat_max=${lat_max}&lon_min=${lon_min}&lon_max=${lon_max}`
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
  if (input.lat_min) {
    params.set('lat_min', String(input.lat_min));
    params.set('lat_max', String(input.lat_max));
    params.set('lon_min', String(input.lon_min));
    params.set('lon_max', String(input.lon_max));
  }
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/conflicts?${params.toString()}`
  );
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
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/infrastructure?${params.toString()}`
  );
  const data = await res.json();
  const items = (data.data || data || []).slice(0, 50);
  return JSON.stringify({ count: items.length, facilities: items });
}

async function queryWeather(input: Record<string, any>): Promise<string> {
  const { latitude, longitude } = input;
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code&timezone=auto`
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
