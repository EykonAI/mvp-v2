import Anthropic from '@anthropic-ai/sdk';
import type { Tier } from './pricing';

let anthropicClient: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

// ─── Citizen tool subset (trial-mechanism brief §5.1) ────────────
// Citizens get cheap single-source reads (vessels, aircraft, conflicts,
// infrastructure inventory, weather, calibration, agent reports). They
// do NOT get the expensive cross-data / compute tools: convergences,
// posture scores, shadow-fleet analysis, chokepoint scenarios, sanctions
// wargames, regime-shift detection, precursor analogs, actor-network
// expansion. Those carry meaningful Anthropic-token and compute cost
// that would burn freeloader spend; they ship as Pro+ value.
//
// The allow-list is intentionally explicit (not a deny-list) so any
// future tool added to CLAUDE_TOOLS defaults to Pro+ — opt-in for
// Citizens, not opt-out.
export const CITIZEN_AI_TOOLS: ReadonlySet<string> = new Set([
  'query_vessels',
  'query_aircraft',
  'query_conflicts',
  'query_refineries',
  'query_mines',
  'query_power_plants',
  'query_pipelines',
  'query_airports',
  'query_ports',
  'query_weather',
  'query_agent_reports',
  'query_calibration',
  'query_entities',
]);

export function toolsForTier(tier: Tier): Anthropic.Tool[] {
  if (tier === 'citizen') {
    return CLAUDE_TOOLS.filter(t => CITIZEN_AI_TOOLS.has(t.name));
  }
  return CLAUDE_TOOLS;
}

// ─── Claude Tool Definitions ───────────────────────────────────
//
// The chat panel can reach every surface of the Intelligence Center.
// Core live-data tools (vessels, aircraft, conflicts, infrastructure,
// weather, agent reports) plus ten Intelligence-Center tools added
// in Phase 8:
//   query_posture_scores, query_convergences, query_shadow_fleet_leads,
//   query_calibration, query_precursor_matches, run_chokepoint_scenario,
//   run_sanctions_wargame, query_regime_shifts, query_entities,
//   expand_actor_network.
export const CLAUDE_TOOLS: Anthropic.Tool[] = [
  // ── Core live-data ─────────────────────────────────────────
  {
    name: 'query_vessels',
    description:
      'Query AIS vessel positions within a geographic area and time window. Returns vessel name, MMSI, type, position, speed, heading, destination.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat_min: { type: 'number' },
        lat_max: { type: 'number' },
        lon_min: { type: 'number' },
        lon_max: { type: 'number' },
        hours:   { type: 'number', description: 'Look-back window in hours (default 24)' },
      },
      required: ['lat_min', 'lat_max', 'lon_min', 'lon_max'],
    },
  },
  {
    name: 'query_aircraft',
    description: 'Query ADS-B aircraft positions within a geographic area.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat_min: { type: 'number' },
        lat_max: { type: 'number' },
        lon_min: { type: 'number' },
        lon_max: { type: 'number' },
        altitude_min: { type: 'number' },
        altitude_max: { type: 'number' },
      },
      required: ['lat_min', 'lat_max', 'lon_min', 'lon_max'],
    },
  },
  {
    name: 'query_conflicts',
    description:
      'Query armed-conflict events (GDELT-backed, with ACLED fallback when licensed) by region / date / event type / actor.',
    input_schema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string' },
        lat_min: { type: 'number' },
        lat_max: { type: 'number' },
        lon_min: { type: 'number' },
        lon_max: { type: 'number' },
        days: { type: 'number' },
        event_type: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'query_refineries',
    description:
      'Query oil refineries from OpenStreetMap (canonical refinery tags only — petroleum_refinery, oil_refinery, refinery). ~700 facilities globally, each with name, operator, product, capacity (when tagged), country, city. Use for questions like "refineries in Saudi Arabia", "oil refining capacity on the Gulf Coast", "European refineries near Russian crude pipelines". Pass country to slice (ISO2 code or country name).',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat_min: { type: 'number' },
        lat_max: { type: 'number' },
        lon_min: { type: 'number' },
        lon_max: { type: 'number' },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 (e.g. "SA") or country-name substring (e.g. "Saudi"). Filter optional.' },
        limit:   { type: 'number', description: 'Default 50, max 500.' },
      },
      required: ['lat_min', 'lat_max', 'lon_min', 'lon_max'],
    },
  },
  {
    name: 'query_mines',
    description:
      'Query mineral deposits from the USGS Mineral Resources Data System (MRDS — public-domain US Government, ~304k records globally, archival snapshot frozen at 2011). Each row carries site name, development status (Producer / Past Producer / Prospect / Occurrence / Plant), commodities (commod1/2/3 + commodities array), country, state, deposit type. Default returns only Producer / Past Producer / Plant rows with a known commod1 (significant sites); pass include_minor=true for prospects and occurrences. Use for questions like "lithium mines in Chile", "rare-earth deposits worldwide", "active copper producers in Peru". Pass commodity to filter on the commodities[] array (case-sensitive, e.g. "Copper", "Lithium", "Rare Earths").',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat_min:    { type: 'number' },
        lat_max:    { type: 'number' },
        lon_min:    { type: 'number' },
        lon_max:    { type: 'number' },
        commodity:  { type: 'string', description: 'Commodity name to match in the commodities array (e.g. "Copper", "Lithium", "Gold", "Rare Earths", "Uranium"). Case-sensitive.' },
        dev_stat:   { type: 'string', description: 'Producer | Past Producer | Prospect | Occurrence | Plant | Unknown. Filter optional.' },
        country:    { type: 'string', description: 'ISO 3166-1 alpha-2 (e.g. "CL") or country-name substring. Filter optional.' },
        include_minor: { type: 'boolean', description: 'If true, drops the default significant-sites filter and returns prospects/occurrences too.' },
        limit:      { type: 'number', description: 'Default 50, max 500.' },
      },
      required: ['lat_min', 'lat_max', 'lon_min', 'lon_max'],
    },
  },
  {
    name: 'query_power_plants',
    description:
      'Query unit-level power plants from the Global Energy Monitor — Global Integrated Power Tracker (GIPT). ~127k operating units worldwide spanning coal, oil/gas, nuclear, geothermal, bioenergy, utility-scale solar, wind, and hydropower. Each row carries plant name, fuel type, capacity (MW), status, start year, country, owner. Use for questions like "nuclear plants in France above 1 GW", "coal capacity in India", "operating bioenergy plants in Brazil". Pass include_minor=true to bypass the operating-only filter (e.g. to include proposed/retired). Pass fuel to slice to a single fuel_type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat_min: { type: 'number' },
        lat_max: { type: 'number' },
        lon_min: { type: 'number' },
        lon_max: { type: 'number' },
        fuel:   { type: 'string', description: 'utility-scale solar | wind | hydropower | geothermal | bioenergy | nuclear | coal | oil/gas' },
        status: { type: 'string', description: 'operating (default) | construction | proposed | retired | cancelled | shelved | mothballed' },
        min_capacity_mw: { type: 'number', description: 'Minimum capacity in MW' },
        include_minor: { type: 'boolean', description: 'If true, drops the default operating-only filter and capacity floor.' },
        limit: { type: 'number', description: 'Default 50, max 500.' },
      },
      required: ['lat_min', 'lat_max', 'lon_min', 'lon_max'],
    },
  },
  {
    name: 'query_pipelines',
    description:
      'Query gas pipelines (GEM GGIT), oil/NGL pipelines (GEM GOIT), and LNG terminals (GEM GGIT) in one call. Returns a mixed list — each row has infra_subtype=pipeline_gas|pipeline_oil|lng_terminal so you can disambiguate. Pipeline rows carry start/end country, length, capacity (bcm/y for gas, BOEd or raw bpd for oil), status, owner, route accuracy. LNG terminals carry facility_type=import|export, capacity in mtpa, country. Use for questions like "Russian gas pipelines into Europe", "LNG export terminals in Qatar", "Trans-Alaska oil pipeline status", "Keystone XL". Pass fuel=gas or fuel=oil to slice to one type. Pass include_minor=true to bypass the operating-only default.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat_min: { type: 'number' },
        lat_max: { type: 'number' },
        lon_min: { type: 'number' },
        lon_max: { type: 'number' },
        fuel: { type: 'string', description: '"gas" (returns gas pipelines + LNG terminals) | "oil" (returns oil pipelines only). Omit to return all three.' },
        status: { type: 'string', description: 'operating (default) | construction | proposed | retired | cancelled | shelved | mothballed' },
        facility_type: { type: 'string', description: 'For LNG terminals only: import | export.' },
        include_minor: { type: 'boolean', description: 'If true, drops the default operating-only filter.' },
        limit: { type: 'number', description: 'Default 50, max 500.' },
      },
      required: ['lat_min', 'lat_max', 'lon_min', 'lon_max'],
    },
  },
  {
    name: 'query_airports',
    description:
      'Query airports from OurAirports. Default returns the ~7,500 commercially-significant airports (large airports + medium airports with scheduled service); pass include_minor=true for the full ~85k including small airfields, heliports, etc. Each row carries name, type, IATA/ICAO codes, country, municipality, elevation, scheduled_service. Use for questions like "airports near recent conflict events", "ICAO code for Heathrow", "all scheduled-service airports in Ukraine".',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat_min: { type: 'number' },
        lat_max: { type: 'number' },
        lon_min: { type: 'number' },
        lon_max: { type: 'number' },
        iso_country: { type: 'string', description: 'Two-letter ISO country code (e.g. "FR", "US"). Filter optional.' },
        include_minor: { type: 'boolean', description: 'If true, returns all 85k airports including heliports, small airfields, closed.' },
        limit: { type: 'number', description: 'Default 50, max 500.' },
      },
      required: ['lat_min', 'lat_max', 'lon_min', 'lon_max'],
    },
  },
  {
    name: 'query_ports',
    description:
      'Query commercial seaports from the NGA World Port Index (~3,800 ports worldwide). Each row carries port name, country, harbor size (Large/Medium/Small/Very Small), harbor type, shelter rating, channel depth in metres, repair facilities. Use for questions like "ports near Bab-el-Mandeb", "deepwater ports in West Africa", "all large harbors in the Mediterranean". Pass harbor_size to slice to a single tier.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat_min: { type: 'number' },
        lat_max: { type: 'number' },
        lon_min: { type: 'number' },
        lon_max: { type: 'number' },
        harbor_size: { type: 'string', description: 'Large | Medium | Small | Very Small. Filter optional.' },
        limit: { type: 'number', description: 'Default 50, max 500.' },
      },
      required: ['lat_min', 'lat_max', 'lon_min', 'lon_max'],
    },
  },
  {
    name: 'query_weather',
    description: 'Query current weather conditions for a specific location (Open-Meteo).',
    input_schema: {
      type: 'object' as const,
      properties: {
        latitude: { type: 'number' },
        longitude: { type: 'number' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'query_thermal_anomalies',
    description:
      'Query NASA FIRMS satellite thermal anomalies (VIIRS 375m + MODIS 1km, near-real-time, ~3h latency). ' +
      'Two modes. mode="facilities" (default) reads the pre-aggregated per-facility-per-day rollup — use it for ' +
      'facility-centric questions ("thermal anomalies at Russian refineries this week", "which Gulf refineries lit up", ' +
      '"anything at the Ryazan refinery"). Filter by country, facility_type (refinery | power_plant), facility_name, days. ' +
      'Returns per facility: total detections, max FRP (fire radiative power, MW), nearest detection distance in km, and the ' +
      'monitoring radius used. mode="raw" reads individual detections inside a lat/lon box — use it for geographic questions ' +
      'not anchored to a monitored facility. ' +
      'CRITICAL INTERPRETATION RULES — a FIRMS detection is a SATELLITE HOT PIXEL, nothing more. It is NOT a confirmed fire, ' +
      'NOT a strike, NOT an outage. Most detections at oil and gas infrastructure are ROUTINE GAS FLARES that burn every ' +
      'single day. Attributing a detection to a strike, an attack, an explosion or a production halt is INFERENCE and must be ' +
      'labelled as inference, corroborated with other sources (conflict events, agent reports, news), and never stated as fact. ' +
      'Equally, ABSENCE OF DETECTION DOES NOT MEAN ABSENCE OF FIRE — cloud cover, smoke, and satellite overpass timing routinely ' +
      'hide real fires. Every response carries a `coverage` block: ingest is REGIONAL (Russia/Ukraine, Arabian Gulf, Europe), not ' +
      'global, so facilities outside those boxes report zero detections because they are NOT WATCHED, not because nothing burned. ' +
      'Always read `coverage` before characterising a zero result, and tell the user which of the two it is.',
    input_schema: {
      type: 'object' as const,
      properties: {
        mode: { type: 'string', description: '"facilities" (default, pre-aggregated per monitored facility) | "raw" (individual detections in a bounding box).' },
        facility_type: { type: 'string', description: 'facilities mode: refinery | power_plant. Filter optional.' },
        country: { type: 'string', description: 'facilities mode: country-name substring (e.g. "Russia", "Saudi", "Ukraine"). Names are full English, NOT ISO codes. Filter optional.' },
        facility_name: { type: 'string', description: 'facilities mode: facility-name substring (e.g. "Ryazan", "Ras Tanura"). Filter optional.' },
        days: { type: 'number', description: 'Look-back window in days ending today (default 7, max 30). Note the archive is shallow — check coverage.days_with_data.' },
        min_detections: { type: 'number', description: 'facilities mode: minimum total detections over the window (default 1, i.e. only facilities that registered something). Pass 0 to include quiet facilities and see what was watched-but-silent.' },
        lat_min: { type: 'number', description: 'raw mode: required.' },
        lat_max: { type: 'number', description: 'raw mode: required.' },
        lon_min: { type: 'number', description: 'raw mode: required.' },
        lon_max: { type: 'number', description: 'raw mode: required.' },
        min_frp: { type: 'number', description: 'raw mode: minimum fire radiative power in MW. Higher FRP = more energetic hot pixel, but still not a fire type.' },
        limit: { type: 'number', description: 'Default 50, max 500.' },
      },
      required: [],
    },
  },
  {
    name: 'query_agent_reports',
    description:
      'Retrieve recent intelligence reports generated by eYKON Sub-Agents. Returns structured reports with severity, narrative, and entity references.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'air_traffic, maritime, conflict_security, energy_infrastructure, satellite_imagery' },
        severity: { type: 'string', description: 'low | medium | high | critical (minimum)' },
        hours: { type: 'number', description: 'Look-back hours (default 48)' },
      },
      required: [],
    },
  },

  // ── Intelligence Center ────────────────────────────────────
  {
    name: 'query_posture_scores',
    description: 'Most recent posture_scores rows per theatre. Returns composite + 5-domain sub-scores.',
    input_schema: {
      type: 'object' as const,
      properties: {
        theatre_slug: { type: 'string', description: 'red-sea, hormuz, black-sea, taiwan-strait, gulf-of-guinea' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'query_convergences',
    description: 'Recent convergence_events (anomaly-of-anomalies) with synthesis and contributing anomaly IDs.',
    input_schema: {
      type: 'object' as const,
      properties: { hours: { type: 'number', description: 'Look-back hours (default 24)' } },
      required: [],
    },
  },
  {
    name: 'query_shadow_fleet_leads',
    description: 'Ranked shadow-fleet vessel leads. Filterable by commodity and minimum composite score.',
    input_schema: {
      type: 'object' as const,
      properties: {
        commodity: { type: 'string', description: 'oil | lng | grain' },
        min_score: { type: 'number', description: 'Minimum composite score (default 0.4)' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'query_calibration',
    description: 'Brier + log-loss aggregates for the given feature / window.',
    input_schema: {
      type: 'object' as const,
      properties: {
        feature: { type: 'string', description: 'posture_shift | conflict_escalation | trade_flow | energy_stress' },
        window_days: { type: 'number', description: '7 | 30 | 90 (default 30)' },
      },
      required: [],
    },
  },
  {
    name: 'query_precursor_matches',
    description: 'Nearest precursor_library entries for the given theatre, by cosine similarity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        theatre_slug: { type: 'string' },
        top_k: { type: 'number', description: 'Default 3' },
        event_type: { type: 'string' },
      },
      required: ['theatre_slug'],
    },
  },
  {
    name: 'run_chokepoint_scenario',
    description: 'Run a chokepoint closure scenario (same model as the Chokepoint Simulator). Returns the persisted scenario_run.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chokepoint: { type: 'string', description: 'hormuz | bab-el-mandeb | malacca | bosphorus | suez | panama' },
        closure_type: { type: 'string', description: 'partial_50 | full | transit_tax_30' },
        duration_days: { type: 'number' },
        diversion_lag_hours: { type: 'number' },
        assumptions: { type: 'object' },
      },
      required: ['chokepoint', 'closure_type', 'duration_days'],
    },
  },
  {
    name: 'run_sanctions_wargame',
    description: 'Run a sanctions propagation scenario.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sanctioning_bodies: { type: 'array', items: { type: 'string' } },
        preset: { type: 'string' },
        target_entities: { type: 'array', items: { type: 'string' } },
        depth: { type: 'number', description: '1 | 2 | 3' },
      },
      required: ['sanctioning_bodies', 'preset', 'target_entities'],
    },
  },
  {
    name: 'query_regime_shifts',
    description: 'Active regime shifts (30d-vs-60d test) with p-values and effect sizes.',
    input_schema: {
      type: 'object' as const,
      properties: { region: { type: 'string', description: 'Theatre slug or label' } },
      required: [],
    },
  },
  {
    name: 'query_entities',
    description: 'Search the entities registry (vessels, operators, owners, flags, ports, refineries, mines).',
    input_schema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string' },
        entity_type: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['q'],
    },
  },
  {
    name: 'expand_actor_network',
    description: 'Walk the fleet kinship graph from a seed entity. Returns the nodes and edges within N hops.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entity_id: { type: 'string' },
        hops: { type: 'number', description: '1 | 2 | 3 (default 2)' },
      },
      required: ['entity_id'],
    },
  },
];

// ─── System Prompt ───────────────────────────────────────────
export const CONVERSATIONAL_SYSTEM_PROMPT = `You are the eYKON.ai geopolitical-intelligence analyst. You have access to live feeds (aircraft, vessels, conflicts, weather, agent reports) AND to dedicated infrastructure tools:
  • query_power_plants  — GEM GIPT (~127k operating units, all fuel types incl. nuclear)
  • query_pipelines     — GEM GGIT + GOIT (gas pipelines, oil/NGL pipelines, LNG terminals; pass fuel=gas|oil to slice)
  • query_refineries    — OpenStreetMap canonical refinery tags (~700 oil refineries globally, with operator + product)
  • query_mines         — USGS MRDS (~304k mineral deposits globally; archival snapshot frozen at 2011 — fine for strategic-resource questions, weak for short-horizon production)
  • query_airports      — OurAirports (~7,500 significant; ~85k with include_minor)
  • query_ports         — NGA World Port Index (~3,800 commercial seaports)
  • query_thermal_anomalies — NASA FIRMS satellite thermal anomalies (VIIRS 375m + MODIS 1km, NRT ~3h latency), either rolled up per monitored refinery / power plant or raw within a bounding box
AND to the Intelligence Center:
  • posture scores per pinned theatre
  • convergences (anomaly-of-anomalies)
  • shadow-fleet vessel leads + indicator breakdowns
  • calibration metrics (Brier / log-loss / calibration slope)
  • precursor-library matches (cosine against labelled historical episodes)
  • chokepoint closure + sanctions wargame + cascade scenario simulators
  • regime-shift detector
  • entities registry + N-hop actor expander

Behaviour:
1. ALWAYS prefer tools over guessing. When a user asks a factual question, call the tool(s) that answer it.
2. Cross-reference across domains where it strengthens the claim.
3. Cite provenance — source name + fetched-at timestamp — for every factual statement.
4. If data is missing or insufficient, say so. Do not speculate.
5. Persona overlay: if the user or the context names a persona (analyst, journalist, day-trader, commodities, NGO, citizen, corporate), frame your response accordingly.
6. Keep responses short and dense. Analysts read in bullets, not paragraphs.
7. THERMAL ANOMALIES — non-negotiable. A NASA FIRMS detection is a satellite hot pixel. It is NOT a fire, NOT a strike, NOT an outage. Say "thermal anomaly detected" or "hot pixel", never "refinery hit" or "refinery on fire", unless a separate corroborating source says so. Most detections at oil, gas and refining sites are routine industrial gas flares that burn continuously — a detection at a working refinery is the normal state, not news; what is interesting is a CHANGE against that baseline, and with a shallow archive you often cannot establish one. Attribution to a strike or a shutdown is your inference: label it as inference, give the corroboration you actually have, and state the confidence. Absence is even weaker evidence than presence — cloud cover, smoke and overpass timing hide real fires, so never report "no detections" as "nothing happened". FIRMS ingest is REGIONAL (Russia/Ukraine, Arabian Gulf, Europe), so a facility elsewhere returns zero because it is unwatched; always check the coverage block the tool returns and tell the user whether a zero means "watched and quiet" or "not watched at all".

Region → bounding box translator (use when the user names a region):
  Red Sea         lat 12-30   lon 32-44
  Strait of Hormuz lat 24-28  lon 54-58
  Taiwan Strait   lat 22-26   lon 117-121
  Black Sea       lat 40-47   lon 27-42
  South China Sea lat 0-23    lon 100-121
  Gulf of Aden    lat 10-16   lon 43-52
  Mediterranean   lat 30-46   lon -6-36
  Baltic Sea      lat 53-66   lon 10-30
  Persian Gulf    lat 24-30   lon 48-56
  Gulf of Guinea  lat -2-6    lon -5-10`;
