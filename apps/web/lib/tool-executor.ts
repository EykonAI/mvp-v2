// ─── Tool Executor: resolves Claude tool calls against live data ───
import { createServerSupabase } from './supabase-server';
import { toFips, toIso2 } from './geography/country-codes';
import { simulateChokepoint } from './intel/chokepoint';
import { runWargame } from './intel/sanctions';
import { FIRMS_REGIONS } from './firms/client';

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function executeToolCall(toolName: string, toolInput: Record<string, any>): Promise<string> {
  try {
    switch (toolName) {
      // Core live-data
      case 'query_vessels':             return await queryVessels(toolInput);
      case 'query_aircraft':            return await queryAircraft(toolInput);
      case 'query_conflicts':           return await queryConflicts(toolInput);
      case 'query_power_plants':        return await queryPowerPlants(toolInput);
      case 'query_pipelines':           return await queryPipelines(toolInput);
      case 'query_refineries':          return await queryRefineries(toolInput);
      case 'query_mines':               return await queryMines(toolInput);
      case 'query_airports':            return await queryAirports(toolInput);
      case 'query_ports':               return await queryPorts(toolInput);
      case 'query_weather':             return await queryWeather(toolInput);
      case 'query_thermal_anomalies':   return await queryThermalAnomalies(toolInput);
      case 'query_nightlights':        return await queryNightlights(toolInput);
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
  // conflict_events.country is FIPS 10-4 (GDELT). Translate name/ISO → FIPS.
  if (input.country) params.set('country', toFips(String(input.country)) ?? String(input.country));
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

// GEM Global Integrated Power Tracker (~127k operating units).
async function queryPowerPlants(input: Record<string, any>): Promise<string> {
  const params = new URLSearchParams({
    lat_min: String(input.lat_min),
    lat_max: String(input.lat_max),
    lon_min: String(input.lon_min),
    lon_max: String(input.lon_max),
  });
  if (input.fuel) params.set('fuel', String(input.fuel));
  if (input.status) params.set('status', String(input.status));
  if (input.include_minor) params.set('include_minor', 'true');
  const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50)));
  const res = await fetch(`${APP_URL()}/api/power-plants?${params.toString()}`);
  const data = await res.json();
  let plants = (data.data || []).slice(0, limit);
  if (input.min_capacity_mw !== undefined) {
    const min = Number(input.min_capacity_mw);
    plants = plants.filter((p: any) => Number(p.capacity_mw) >= min);
  }
  return JSON.stringify({
    count: plants.length,
    provider: data.provider,
    attribution: data.attribution,
    plants: plants.map((p: any) => ({
      id: p.id,
      plant_name: p.plant_name,
      unit_name: p.unit_name,
      fuel: p.fuel_type,
      technology: p.technology,
      capacity_mw: p.capacity_mw,
      status: p.status,
      start_year: p.start_year,
      country: p.country,
      subnational: p.subnational_unit,
      owner: p.owner,
      operator: p.operator,
      lat: p.latitude,
      lon: p.longitude,
      wiki: p.gem_wiki_url,
    })),
  });
}

// GEM Global Gas Infrastructure Tracker — pipelines + LNG terminals.
// Strips the heavy route_geojson before returning so the AI gets summary
// metadata rather than 100s of KB of geometry per row.
async function queryPipelines(input: Record<string, any>): Promise<string> {
  const params = new URLSearchParams({
    lat_min: String(input.lat_min),
    lat_max: String(input.lat_max),
    lon_min: String(input.lon_min),
    lon_max: String(input.lon_max),
  });
  if (input.status) params.set('status', String(input.status));
  if (input.facility_type) params.set('facility_type', String(input.facility_type));
  if (input.include_minor) params.set('include_minor', 'true');
  const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50)));
  const res = await fetch(`${APP_URL()}/api/pipelines?${params.toString()}`);
  const data = await res.json();
  const items = (data.data || []).slice(0, limit);
  return JSON.stringify({
    count: items.length,
    pipelines_count: data.pipelines_count,
    terminals_count: data.terminals_count,
    provider: data.provider,
    attribution: data.attribution,
    items: items.map((it: any) => {
      if (it.infra_subtype === 'lng_terminal') {
        return {
          infra_subtype: 'lng_terminal',
          id: it.id,
          terminal_name: it.terminal_name,
          facility_type: it.facility_type,
          fuel: it.fuel,
          status: it.status,
          country: it.country,
          capacity_mtpa: it.capacity_mtpa,
          capacity_bcm_y: it.capacity_bcm_y,
          start_year: it.start_year,
          offshore: it.offshore,
          floating: it.floating,
          owner: it.owner,
          operator: it.operator,
          lat: it.latitude,
          lon: it.longitude,
          wiki: it.wiki_url,
        };
      }
      return {
        infra_subtype: 'pipeline',
        id: it.id,
        pipeline_name: it.pipeline_name,
        segment_name: it.segment_name,
        fuel: it.fuel,
        status: it.status,
        countries: it.countries,
        start_country: it.start_country,
        end_country: it.end_country,
        capacity_bcm_y: it.capacity_bcm_y,
        length_km: it.length_km,
        start_year: it.start_year,
        owner: it.owner,
        route_accuracy: it.route_accuracy,
        wiki: it.wiki_url,
        // route_geojson intentionally omitted — too large for tool response budget.
      };
    }),
  });
}

// OSM Overpass-backed refineries (~700 globally — canonical refinery tags).
async function queryRefineries(input: Record<string, any>): Promise<string> {
  const params = new URLSearchParams({
    lat_min: String(input.lat_min),
    lat_max: String(input.lat_max),
    lon_min: String(input.lon_min),
    lon_max: String(input.lon_max),
  });
  // refineries.country is ISO2. Translate name/ISO3/FIPS → ISO2.
  if (input.country) params.set('country', toIso2(String(input.country)) ?? String(input.country));
  const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50)));
  const res = await fetch(`${APP_URL()}/api/refineries?${params.toString()}`);
  const data = await res.json();
  const items = (data.data || []).slice(0, limit);
  return JSON.stringify({
    count: items.length,
    provider: data.provider,
    attribution: data.attribution,
    refineries: items.map((r: any) => ({
      id: r.id,
      name: r.refinery_name,
      operator: r.operator,
      owner: r.owner,
      product: r.product,
      capacity_bpd: r.capacity_bpd,
      start_date: r.start_date,
      country: r.country,
      iso_country: r.iso_country,
      city: r.city,
      lat: r.latitude,
      lon: r.longitude,
      wiki: r.wiki_url,
    })),
  });
}

// USGS MRDS-backed mines (~304k globally — archival snapshot frozen at 2011).
async function queryMines(input: Record<string, any>): Promise<string> {
  const params = new URLSearchParams({
    lat_min: String(input.lat_min),
    lat_max: String(input.lat_max),
    lon_min: String(input.lon_min),
    lon_max: String(input.lon_max),
  });
  if (input.commodity) params.set('commodity', String(input.commodity));
  if (input.dev_stat) params.set('dev_stat', String(input.dev_stat));
  // mines.country is ISO2. Translate name/ISO3/FIPS → ISO2.
  if (input.country) params.set('country', toIso2(String(input.country)) ?? String(input.country));
  if (input.include_minor) params.set('include_minor', 'true');
  const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50)));
  const res = await fetch(`${APP_URL()}/api/mines?${params.toString()}`);
  const data = await res.json();
  const items = (data.data || []).slice(0, limit);
  return JSON.stringify({
    count: items.length,
    provider: data.provider,
    attribution: data.attribution,
    mines: items.map((m: any) => ({
      id: m.id,
      name: m.site_name,
      dev_stat: m.dev_stat,
      commodities: m.commodities,
      commod1: m.commod1,
      ore: m.ore,
      dep_type: m.dep_type,
      country: m.country,
      iso_country: m.iso_country,
      state: m.state,
      county: m.county,
      lat: m.latitude,
      lon: m.longitude,
      url: m.url,
    })),
  });
}

// OurAirports (~85k total; default ~7,500 commercially significant).
async function queryAirports(input: Record<string, any>): Promise<string> {
  const params = new URLSearchParams({
    lat_min: String(input.lat_min),
    lat_max: String(input.lat_max),
    lon_min: String(input.lon_min),
    lon_max: String(input.lon_max),
  });
  if (input.include_minor) params.set('include_minor', 'true');
  const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50)));
  const res = await fetch(`${APP_URL()}/api/airports?${params.toString()}`);
  const data = await res.json();
  let airports = (data.data || []);
  if (input.iso_country) {
    const code = String(input.iso_country).toUpperCase();
    airports = airports.filter((a: any) => (a.iso_country || '').toUpperCase() === code);
  }
  airports = airports.slice(0, limit);
  return JSON.stringify({
    count: airports.length,
    provider: data.provider,
    airports: airports.map((a: any) => ({
      id: a.id,
      name: a.name,
      ident: a.ident,
      iata: a.iata_code,
      icao: a.icao_code,
      type: a.type,
      country: a.iso_country,
      municipality: a.municipality,
      elevation_ft: a.elevation_ft,
      scheduled_service: a.scheduled_service,
      lat: a.latitude,
      lon: a.longitude,
    })),
  });
}

// NGA World Port Index (~3,800 commercial seaports).
async function queryPorts(input: Record<string, any>): Promise<string> {
  const params = new URLSearchParams({
    lat_min: String(input.lat_min),
    lat_max: String(input.lat_max),
    lon_min: String(input.lon_min),
    lon_max: String(input.lon_max),
  });
  if (input.harbor_size) params.set('harbor_size', String(input.harbor_size));
  const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50)));
  const res = await fetch(`${APP_URL()}/api/ports?${params.toString()}`);
  const data = await res.json();
  const ports = (data.data || []).slice(0, limit);
  return JSON.stringify({
    count: ports.length,
    provider: data.provider,
    ports: ports.map((p: any) => ({
      id: p.id,
      port_name: p.port_name,
      country: p.country,
      unlocode: p.unlocode,
      harbor_size: p.harbor_size,
      harbor_type: p.harbor_type,
      shelter: p.shelter,
      channel_depth_m: p.channel_depth_m,
      repairs: p.repairs,
      lat: p.latitude,
      lon: p.longitude,
    })),
  });
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

// NASA FIRMS thermal anomalies (VIIRS 375m + MODIS 1km NRT).
//
// HONESTY CONTRACT — a detection is a satellite hot pixel, not a fire and
// not a strike; most hot pixels at oil/gas infrastructure are routine
// flares; and absence of detection does not imply absence of fire (cloud,
// smoke, overpass timing). Ingest is also REGIONAL, not global, so a
// facility outside the monitored boxes reads zero because nobody looked.
// Every response therefore ships `caveat` + `coverage` alongside the data
// so the model cannot present a zero as "nothing happened".
const FIRMS_CAVEAT =
  'A FIRMS detection is a satellite hot pixel — NOT a confirmed fire, strike or outage. ' +
  'Most detections at oil/gas/refining sites are routine industrial gas flares that burn daily. ' +
  'Attribution to a strike or shutdown is inference: label it as such and corroborate it. ' +
  'Absence of detection does NOT imply absence of fire (cloud cover, smoke, overpass timing). ' +
  'Ingest is regional, not global — check coverage before calling a zero result quiet.';

async function firmsCoverage(supabase: any, sinceDate: string) {
  const { data, error } = await supabase
    .from('firms_ingest_runs')
    .select('region, satellite, day_covered, ok, rows_upserted, ran_at')
    .gte('day_covered', sinceDate)
    .order('day_covered', { ascending: false })
    .limit(1000);
  if (error) {
    return { note: 'Ingest ledger unavailable — treat any zero result as unverified coverage.' };
  }
  const runs = data ?? [];
  const okRuns = runs.filter((r: any) => r.ok);
  const days = Array.from(new Set(okRuns.map((r: any) => r.day_covered))).sort();
  const failed = runs.filter((r: any) => !r.ok);
  return {
    monitored_regions: FIRMS_REGIONS.map(r => ({ slug: r.slug, label: r.label, bbox: r.bbox })),
    global: false,
    days_with_data: days,
    days_with_data_count: days.length,
    latest_day_covered: days.length ? days[days.length - 1] : null,
    failed_runs: failed.length,
    note:
      'Ingest covers ONLY the monitored_regions bounding boxes. Facilities outside them ' +
      '(e.g. China, the Americas, East Asia) return zero detections because they are not ' +
      'watched — that is not evidence of quiet. Within a covered region, a zero means ' +
      'watched-and-nothing-detected, which still does not rule out a cloud-obscured fire.',
  };
}

async function queryThermalAnomalies(input: Record<string, any>): Promise<string> {
  try {
    const supabase = createServerSupabase();
    const mode = String(input.mode ?? 'facilities').toLowerCase() === 'raw' ? 'raw' : 'facilities';
    const days = Math.min(30, Math.max(1, Number(input.days ?? 7)));
    const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50)));
    const sinceDate = new Date(Date.now() - days * 24 * 3600_000).toISOString().slice(0, 10);
    const coverage = await firmsCoverage(supabase, sinceDate);
    const provider = 'NASA FIRMS (VIIRS S-NPP/NOAA-20 375m + MODIS 1km, NRT)';
    const attribution = 'NASA FIRMS — data courtesy of NASA/LANCE/EOSDIS';

    if (mode === 'raw') {
      let q = supabase
        .from('firms_thermal_anomalies')
        .select('satellite, acq_date, acq_time, latitude, longitude, brightness, bright_ti5, frp, confidence, daynight')
        .gte('acq_date', sinceDate)
        .order('frp', { ascending: false, nullsFirst: false })
        .limit(Math.min(2000, limit * 4));
      if (input.lat_min !== undefined) q = q.gte('latitude', Number(input.lat_min));
      if (input.lat_max !== undefined) q = q.lte('latitude', Number(input.lat_max));
      if (input.lon_min !== undefined) q = q.gte('longitude', Number(input.lon_min));
      if (input.lon_max !== undefined) q = q.lte('longitude', Number(input.lon_max));
      if (input.min_frp !== undefined) q = q.gte('frp', Number(input.min_frp));
      const { data, error } = await q;
      if (error) return JSON.stringify({ error: error.message, caveat: FIRMS_CAVEAT, coverage });
      const rows = (data ?? []).slice(0, limit);
      return JSON.stringify({
        mode: 'raw',
        window_days: days,
        since: sinceDate,
        count: rows.length,
        provider,
        attribution,
        caveat: FIRMS_CAVEAT,
        coverage,
        detections: rows.map((d: any) => ({
          satellite: d.satellite,
          acq_date: d.acq_date,
          acq_time_utc: d.acq_time,
          lat: d.latitude,
          lon: d.longitude,
          frp_mw: d.frp === null ? null : Number(d.frp),
          brightness_k: d.brightness === null ? null : Number(d.brightness),
          bright_ti5_k: d.bright_ti5 === null ? null : Number(d.bright_ti5),
          // MODIS reports confidence 0-100; VIIRS reports l | n | h.
          confidence: d.confidence,
          daynight: d.daynight,
        })),
      });
    }

    // facilities mode — pre-aggregated rollup, one row per facility per day
    // (including detection_count = 0 rows for watched-but-silent facilities).
    let q = supabase
      .from('firms_facility_observations')
      .select('facility_type, facility_id, facility_name, country, period, detection_count, max_frp, nearest_km, radius_km')
      .gte('period', sinceDate)
      .limit(5000);
    if (input.facility_type) q = q.eq('facility_type', String(input.facility_type));
    // firms_facility_observations.country is ISO2 (from the infra join).
    // Translate name/ISO3/FIPS → ISO2 so country="Iran" no longer returns 0.
    if (input.country) q = q.eq('country', toIso2(String(input.country)) ?? String(input.country));
    if (input.facility_name) q = q.ilike('facility_name', `%${String(input.facility_name)}%`);
    const { data, error } = await q;
    if (error) return JSON.stringify({ error: error.message, caveat: FIRMS_CAVEAT, coverage });

    const rows = data ?? [];
    const byFacility = new Map<string, any>();
    for (const r of rows) {
      const key = `${r.facility_type}:${r.facility_id}`;
      let f = byFacility.get(key);
      if (!f) {
        f = {
          facility_type: r.facility_type,
          facility_id: r.facility_id,
          facility_name: r.facility_name,
          country: r.country,
          radius_km: r.radius_km === null ? null : Number(r.radius_km),
          detections: 0,
          max_frp_mw: null as number | null,
          nearest_km: null as number | null,
          days_observed: 0,
          days_with_detections: [] as string[],
        };
        byFacility.set(key, f);
      }
      const n = Number(r.detection_count ?? 0);
      f.detections += n;
      f.days_observed += 1;
      if (n > 0) {
        f.days_with_detections.push(r.period);
        const frp = r.max_frp === null ? null : Number(r.max_frp);
        if (frp !== null && (f.max_frp_mw === null || frp > f.max_frp_mw)) f.max_frp_mw = frp;
        const near = r.nearest_km === null ? null : Number(r.nearest_km);
        if (near !== null && (f.nearest_km === null || near < f.nearest_km)) f.nearest_km = near;
      }
    }

    const minDet = input.min_detections === undefined ? 1 : Math.max(0, Number(input.min_detections));
    const all = Array.from(byFacility.values());
    const facilities = all
      .filter(f => f.detections >= minDet)
      .sort((a, b) => b.detections - a.detections || (b.max_frp_mw ?? 0) - (a.max_frp_mw ?? 0))
      .slice(0, limit);
    for (const f of facilities) f.days_with_detections.sort();

    return JSON.stringify({
      mode: 'facilities',
      window_days: days,
      since: sinceDate,
      filters: {
        facility_type: input.facility_type ?? 'all',
        country: input.country ?? 'all',
        facility_name: input.facility_name ?? 'all',
        min_detections: minDet,
      },
      facilities_matching_filters: all.length,
      facilities_with_any_detection: all.filter(f => f.detections > 0).length,
      count: facilities.length,
      provider,
      attribution,
      caveat: FIRMS_CAVEAT,
      coverage,
      facilities,
    });
  } catch (err: any) {
    return JSON.stringify({ error: err?.message ?? 'unknown', caveat: FIRMS_CAVEAT });
  }
}


// ─── Night-lights (NASA Black Marble VNP46A2) ──────────────────────
const NIGHTLIGHTS_CAVEAT =
  'Radiance is NOT power state. A dark pixel is not a confirmed outage: cloud, snow, moon geometry and the ' +
  '~500 m footprint all hide light, so went_dark_lights requires sustained absence across multiple ' +
  'confidently-CLEAR nights and remains an inference. Judgements use confident_clear observations only ' +
  '(cloud scatters city light back at the sensor and would fake both surges and collapses). Absence of a ' +
  'row is absence of a LOOK, never darkness. Counts are per PHYSICAL SITE, not per registry row. NASA ' +
  'publishes ~1-2 weeks behind: check coverage.lag_days and present findings as describing that week, not ' +
  'last night. Thermal (FIRMS) and night-lights are independent sensors - corroborate across both before ' +
  'characterising an outage.';

/**
 * Coverage for night-lights answers. Anchored on the newest night that
 * actually holds rows, NOT the wall clock: NASA publishes VNP46A2 in
 * stages (~1-2 weeks behind), so "the last 14 days" from today is often
 * mostly empty. Every claim downstream is relative to newest_night.
 */
async function nightlightsCoverage(supabase: any) {
  const { data: newestRow, error } = await supabase
    .from('blackmarble_facility_radiance')
    .select('period')
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !newestRow?.period) {
    return {
      newest_night: null,
      lag_days: null,
      note: error
        ? 'Coverage probe failed - treat any zero result as unverified coverage.'
        : 'No radiance rows exist yet - nothing has been observed. Absence of data, not absence of activity.',
    };
  }
  const newest = String(newestRow.period);
  const lagDays = Math.round((Date.now() - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000);
  return {
    newest_night: newest,
    lag_days: lagDays,
    roster: 'FIRMS-watched facilities only (~10,556 refineries + power plants) - not global.',
    note:
      `Newest observed night is ${newest} (${lagDays} days behind today - normal NASA staged publishing). ` +
      'Answers describe that week, not last night. A facility outside the FIRMS-watched roster is not ' +
      'observed at all; within it, a night with no row means the tile was not processed, not that it was dark.',
  };
}

async function queryNightlights(input: Record<string, any>): Promise<string> {
  try {
    const supabase = createServerSupabase();
    const mode = String(input.mode ?? 'events').toLowerCase() === 'radiance' ? 'radiance' : 'events';
    const days = Math.min(60, Math.max(1, Number(input.days ?? 14)));
    const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50)));
    const provider = 'NASA Black Marble (VIIRS VNP46A2, moonlight/atmosphere-corrected nighttime radiance, ~500 m)';
    const attribution = 'NASA Black Marble - data courtesy of NASA/LAADS DAAC';

    const coverage = await nightlightsCoverage(supabase);
    if (!coverage.newest_night) {
      return JSON.stringify({ mode, count: 0, provider, attribution, caveat: NIGHTLIGHTS_CAVEAT, coverage });
    }
    // Window ends at the newest DATA night, not today (see coverage).
    const since = new Date(Date.parse(`${coverage.newest_night}T00:00:00Z`) - days * 86_400_000)
      .toISOString().slice(0, 10);

    if (mode === 'events') {
      // Site-level view (migration 094): one row per physical site per
      // night per event type - the honest unit for any count.
      let q = supabase
        .from('nightlights_significant_sites')
        .select('site_key, site_name, country, period, event_type, unit_rows, latitude, longitude, observed_radiance, baseline_mean, baseline_nights, deviation_sigma, dark_nights')
        .gte('period', since)
        .order('period', { ascending: false })
        .limit(limit);
      if (input.event_type) q = q.eq('event_type', String(input.event_type));
      if (input.country) q = q.ilike('country', `%${String(input.country)}%`);
      if (input.facility_name) q = q.ilike('site_name', `%${String(input.facility_name)}%`);
      const { data, error } = await q;
      if (error) return JSON.stringify({ error: error.message, caveat: NIGHTLIGHTS_CAVEAT, coverage });
      const rows = data ?? [];
      return JSON.stringify({
        mode: 'events',
        window_days: days,
        since,
        count: rows.length,
        counting_unit: 'physical sites (one row per site per night per event type - NOT registry rows)',
        provider,
        attribution,
        caveat: NIGHTLIGHTS_CAVEAT,
        coverage,
        events: rows.map((e: any) => ({
          site_name: e.site_name,
          country: e.country,
          night: e.period,
          event_type: e.event_type,
          observed_radiance_nw: e.observed_radiance === null ? null : Number(e.observed_radiance),
          baseline_mean_nw: e.baseline_mean === null ? null : Number(e.baseline_mean),
          baseline_clear_nights: e.baseline_nights,
          deviation_sigma: e.deviation_sigma === null ? null : Number(e.deviation_sigma),
          consecutive_dark_clear_nights: e.dark_nights,
          registry_unit_rows: e.unit_rows,
          lat: e.latitude === null ? null : Number(e.latitude),
          lon: e.longitude === null ? null : Number(e.longitude),
        })),
      });
    }

    // radiance mode - per-facility nightly rollup. Rows are per registry
    // UNIT: multi-unit plants repeat with identical values (same pixel).
    let q = supabase
      .from('blackmarble_facility_radiance')
      .select('facility_type, facility_id, facility_name, country, period, radiance, radiance_3x3, cloud_confidence')
      .gte('period', since)
      .limit(5000);
    if (input.facility_type) q = q.eq('facility_type', String(input.facility_type));
    if (input.country) q = q.ilike('country', `%${String(input.country)}%`);
    if (input.facility_name) q = q.ilike('facility_name', `%${String(input.facility_name)}%`);
    const { data, error } = await q;
    if (error) return JSON.stringify({ error: error.message, caveat: NIGHTLIGHTS_CAVEAT, coverage });

    const rows = data ?? [];
    const byFacility = new Map<string, any>();
    for (const r of rows) {
      const key = `${r.facility_type}:${r.facility_id}`;
      let f = byFacility.get(key);
      if (!f) {
        f = {
          facility_type: r.facility_type,
          facility_id: r.facility_id,
          facility_name: r.facility_name,
          country: r.country,
          nights_observed: 0,
          clear_nights: 0,
          mean_clear_radiance_nw: null as number | null,
          max_clear_radiance_nw: null as number | null,
          latest_clear_night: null as string | null,
          latest_clear_radiance_nw: null as number | null,
          _sum: 0,
        };
        byFacility.set(key, f);
      }
      f.nights_observed += 1;
      const rad = r.radiance === null ? null : Number(r.radiance);
      if (rad !== null && r.cloud_confidence === 'confident_clear') {
        f.clear_nights += 1;
        f._sum += rad;
        if (f.max_clear_radiance_nw === null || rad > f.max_clear_radiance_nw) f.max_clear_radiance_nw = rad;
        if (f.latest_clear_night === null || r.period > f.latest_clear_night) {
          f.latest_clear_night = r.period;
          f.latest_clear_radiance_nw = rad;
        }
      }
    }
    const facilities = Array.from(byFacility.values())
      .map(f => {
        f.mean_clear_radiance_nw = f.clear_nights > 0 ? Math.round((f._sum / f.clear_nights) * 100) / 100 : null;
        delete f._sum;
        return f;
      })
      .sort((a, b) => (b.mean_clear_radiance_nw ?? -1) - (a.mean_clear_radiance_nw ?? -1))
      .slice(0, limit);

    return JSON.stringify({
      mode: 'radiance',
      window_days: days,
      since,
      count: facilities.length,
      counting_unit:
        'registry facility rows (one per generating unit) - multi-unit plants repeat with IDENTICAL values ' +
        'because they share one ~500 m pixel. Merge same-name/same-value rows before quoting site counts.',
      provider,
      attribution,
      caveat: NIGHTLIGHTS_CAVEAT,
      coverage,
      facilities,
    });
  } catch (err: any) {
    return JSON.stringify({ error: err?.message ?? 'unknown', caveat: NIGHTLIGHTS_CAVEAT });
  }
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
  const res = await fetch(`${APP_URL()}/api/intel/shadow-fleet/leads?${params.toString()}`, { cache: 'no-store' });
  const j = await res.json();
  // silence_hours is hours since the vessel's last AIS fix, measured against the
  // data clock. It replaced last_dark_hours, which reported the age of the
  // database row and so described vessels that were transmitting as "dark".
  return JSON.stringify({
    count: (j.leads ?? []).length,
    leads: j.leads ?? [],
    live: j.live ?? false,
    gap_source: j.gap_source ?? null,
    data_clock: j.data_clock ?? null,
    feed_lag_minutes: j.feed_lag_minutes ?? null,
    coverage: j.coverage ?? null,
    note: 'silence_hours = hours since last AIS fix vs the data clock. Coverage IS gated: vessels last seen in a coverage box that has itself been silent >12h are held VOID and never ranked — see the coverage object for per-box state.',
  });
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
    const output = await runWargame(
      {
        sanctioning_bodies: input.sanctioning_bodies,
        preset: input.preset,
        target_entities: input.target_entities,
        depth: (input.depth ?? 2) as 1 | 2 | 3,
      },
      createServerSupabase(),
    );
    return JSON.stringify({
      fleet_scope: output.fleet_scope,
      top_affected: output.top_affected,
      reflag_destinations: output.reflag_destinations,
      graph_source: output.graph_source,
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function queryRegimeShiftsTool(input: Record<string, any>): Promise<string> {
  const res = await fetch(`${APP_URL()}/api/intel/regime-shifts`);
  const j = await res.json();
  const regions: any[] = j.regions ?? [];

  // Match the slug OR the display label, separator-insensitively: the
  // model naturally passes "Red Sea" or "Strait of Hormuz", while the
  // stored region is "red-sea" / "hormuz". A raw substring test on the
  // slug alone silently returned ZERO regions for those queries — the
  // analyst then reported no regime shifts for a theatre that had two.
  // Falling back to the full set beats answering "none" from a failed
  // match: a wrong filter must never look like an empty world.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let filtered = regions;
  if (input.region) {
    const q = norm(String(input.region));
    const hit = (v: string) => {
      const n = norm(v);
      return n.includes(q) || q.includes(n);
    };
    const matched = regions.filter(r => hit(r.region ?? '') || hit(r.label ?? ''));
    filtered = matched.length > 0 ? matched : regions;
  }

  // Daily arrays are ~10 KB per region and the model never needs the
  // raw series to reason about a shift — it has the means, the KS p,
  // the effect size and the persistence history. Strip them so a
  // six-theatre answer costs a fraction of the tokens.
  const slim = filtered.map(r => ({
    ...r,
    signals: (r.signals ?? []).map(({ old_window, new_window, ...s }: any) => ({
      ...s,
      old_window: old_window ? { ...old_window, daily: undefined } : null,
      new_window: new_window ? { ...new_window, daily: undefined } : null,
    })),
  }));

  return JSON.stringify({
    count: slim.length,
    matched_query: input.region ? String(input.region) : null,
    computed_at: j.computed_at ?? null,
    regions: slim,
    // The markers carry meaning the field names alone do not, and
    // getting them wrong produces a confident WRONG answer — e.g.
    // narrating a vessel "collapse" that is really our own AIS
    // connection degrading. Stated here so the reasoning is grounded
    // in what each flag actually licenses.
    field_notes: {
      p_value: 'Two-sample Kolmogorov-Smirnov on daily values, trailing 30d vs preceding 60d. Shift threshold p < 0.01.',
      effect: 'Standardized mean difference in units of the OLD window standard deviation (sigma), NOT a percentage.',
      thin: 'true = fewer than 8 data days in a window; p is null and NO shift can be claimed. Absence of data, not absence of activity.',
      test: "'ks' = current test; 'z' = pre-2026-08-04 rows scored by an older z-test on means. Never present a z p-value as a KS result.",
      ingest_sensitive:
        'true = the signal rides a best-effort feed (free-tier AIS) whose daily counts confound INGEST THROUGHPUT with real-world activity. A change here is NOT evidence about the world and must never be attributed to the theatre. Say so plainly when asked.',
      history: 'One entry per calendar day: how the same test scored on previous nights. Consecutive shift nights = persistence; a single night is weaker evidence.',
      nightlights_radiance: 'Mean clear-night radiance (nW), not a count. NASA publication lags ~9 days, so it describes last week.',
      thermal_detections: 'Raw hot-pixel counts. A detection is a hot pixel, never a confirmed fire.',
    },
  });
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
