'use client';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, IconLayer, PathLayer, GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import Map, { type MapRef } from 'react-map-gl/maplibre';
import { MAP_CONFIG } from '@/lib/constants';
import type { BBox } from '@/lib/types';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MapViewProps {
  aircraft: any[];
  vessels: any[];
  conflicts: any[];
  airports: any[];
  ports: any[];
  powerPlants: any[];
  pipelines: any[];
  refineries: any[];
  mines: any[];
  /** Fired ~500ms after the user stops panning/zooming, with the visible bbox. */
  onViewportChange?: (bbox: BBox) => void;
}

// GGIT pipeline + LNG-terminal palette: soft peach-yellow (#FFD6A5) for both,
// distinguished by shape — lines for pipelines, ⛁ glyph for terminals.
const PIPELINE_COLOR: [number, number, number, number] = [255, 214, 165, 220];
const LNG_TERMINAL_COLOR: [number, number, number, number] = [255, 214, 165, 240];

// Capacity-proportional pipeline width: sqrt-damped, 1.5–4 px range.
function pipelineWidth(capacity_bcm_y: any): number {
  const c = Number(capacity_bcm_y);
  if (!Number.isFinite(c) || c <= 0) return 1.5;
  return Math.max(1.5, Math.min(4, Math.sqrt(c) * 0.5));
}
// LNG terminal glyph size: capacity-scaled, 10–16 px.
function terminalSize(capacity_mtpa: any): number {
  const c = Number(capacity_mtpa);
  if (!Number.isFinite(c) || c <= 0) return 10;
  return Math.max(10, Math.min(16, Math.sqrt(c) * 2));
}

// Power-plant macro-category. Collapses GIPT's 8 fuel types into three
// strategic buckets:
//  - renewable + fossil share a glyph (⚡), differ by colour
//  - nuclear gets its own multi-colour atom icon, rendered via IconLayer
type PowerCategory = 'renewable' | 'fossil' | 'nuclear' | 'other';
function powerCategory(fuel: string | null | undefined): PowerCategory {
  switch (fuel) {
    case 'utility-scale solar':
    case 'wind':
    case 'hydropower':
    case 'geothermal':
    case 'bioenergy':
      return 'renewable';
    case 'coal':
    case 'oil/gas':
      return 'fossil';
    case 'nuclear':
      return 'nuclear';
    default:
      return 'other';
  }
}
// Colours: turquoise (--teal #19D0B8) for renewable, amber-yellow for fossil.
// Nuclear is rendered via the atom IconLayer, not coloured here.
const POWER_CATEGORY_COLOR: Record<PowerCategory, [number, number, number, number]> = {
  renewable: [ 25, 208, 184, 240],  // var(--teal)   #19D0B8
  fossil:    [245, 200,  66, 240],  // bright yellow  #F5C842
  nuclear:   [255, 255, 255, 240],  // unused (IconLayer handles nuclear)
  other:     [120, 200,  90, 200],
};

// Inline SVG of an atom — two crossed orbital ellipses (turquoise) + nucleus
// and electrons (yellow). Embedded as a data URI so we don't ship a separate
// asset. Drawn at 32×32 with a 16,16 origin so it scales cleanly.
const NUCLEAR_ATOM_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <g transform="translate(16,16)" stroke="#19D0B8" stroke-width="2" fill="none">
    <ellipse rx="13" ry="5" transform="rotate(45)"/>
    <ellipse rx="13" ry="5" transform="rotate(-45)"/>
  </g>
  <g fill="#F5C842" stroke="none">
    <circle cx="16" cy="16" r="3"/>
    <circle cx="25.2" cy="6.8" r="2"/>
    <circle cx="6.8" cy="25.2" r="2"/>
  </g>
</svg>
`.trim();
const NUCLEAR_ATOM_ICON = {
  url: `data:image/svg+xml;utf8,${encodeURIComponent(NUCLEAR_ATOM_SVG)}`,
  width: 32,
  height: 32,
  mask: false,
};

// Capacity-proportional pixel size, sqrt-damped so a 5 GW reactor isn't 50×
// the size of a 100 MW plant. Range tuned to 6–14 px after the world-zoom
// view at 12–28 px composed into a stripey blanket — the ⚡ glyph has too
// many angles to overlap cleanly at large sizes. Atom icons get a 1.4×
// multiplier so the orbits stay readable.
function powerSize(capacity_mw: any): number {
  const c = Number(capacity_mw);
  if (!Number.isFinite(c) || c <= 0) return 6;
  return Math.max(6, Math.min(14, Math.sqrt(c) * 0.4));
}

const VIEWPORT_DEBOUNCE_MS = 500;

export default function MapView({
  aircraft,
  vessels,
  conflicts,
  airports,
  ports,
  powerPlants,
  pipelines,
  refineries,
  mines,
  onViewportChange,
}: MapViewProps) {
  const [viewState, setViewState] = useState(MAP_CONFIG.INITIAL_VIEW);
  const [hoverInfo, setHoverInfo] = useState<any>(null);

  const mapRef = useRef<MapRef>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute current visible bbox from the underlying MapLibre instance and
  // emit upward. MapLibre wraps the antimeridian, so getWest()/getEast() can
  // produce values outside [-180, 180] — clamp to keep server queries sane.
  // Zoom is forwarded too, so server-side layer thinning (e.g. airports
  // showing only large hubs at world zoom) can run on the same fetch.
  const emitBbox = useCallback(() => {
    const m = mapRef.current?.getMap();
    if (!m || !onViewportChange) return;
    const b = m.getBounds();
    onViewportChange({
      latmin: Math.max(-90, b.getSouth()),
      latmax: Math.min(90, b.getNorth()),
      lonmin: Math.max(-180, b.getWest()),
      lonmax: Math.min(180, b.getEast()),
      zoom: m.getZoom(),
    });
  }, [onViewportChange]);

  const handleViewStateChange = useCallback(
    ({ viewState: vs }: any) => {
      setViewState(vs);
      if (!onViewportChange) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(emitBbox, VIEWPORT_DEBOUNCE_MS);
    },
    [emitBbox, onViewportChange],
  );

  // Fire once on initial map load so the parent gets a starting bbox without
  // requiring a user pan.
  const handleMapLoad = useCallback(() => {
    emitBbox();
  }, [emitBbox]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // ─── Aircraft Layer (Yellow/Amber) ───
  const aircraftLayer = useMemo(() => new ScatterplotLayer({
    id: 'aircraft',
    data: aircraft,
    getPosition: (d: any) => [d.longitude || d.lon, d.latitude || d.lat],
    getFillColor: (d: any) => d.military ? [255, 80, 80, 220] : d.on_ground ? [120, 120, 120, 160] : [255, 210, 0, 220],
    getRadius: 28000,
    radiusMinPixels: 2,
    radiusMaxPixels: 7,
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'aircraft' } : null),
    updateTriggers: { getPosition: aircraft.length, getFillColor: aircraft.length },
  }), [aircraft]);

  // ─── Vessel Layer (Blue) ───
  const vesselLayer = useMemo(() => new ScatterplotLayer({
    id: 'vessels',
    data: vessels,
    getPosition: (d: any) => [d.longitude || d.LONGITUDE, d.latitude || d.LATITUDE],
    getFillColor: [30, 130, 255, 210],
    getRadius: 35000,
    radiusMinPixels: 2,
    radiusMaxPixels: 8,
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'vessel' } : null),
    updateTriggers: { getPosition: vessels.length },
  }), [vessels]);

  // ─── Conflict Layer (Red, size proportional to fatalities) ───
  const conflictLayer = useMemo(() => new ScatterplotLayer({
    id: 'conflicts',
    data: conflicts,
    getPosition: (d: any) => [parseFloat(d.longitude), parseFloat(d.latitude)],
    getFillColor: (d: any) => {
      const f = parseInt(d.fatalities) || 0;
      const alpha = Math.min(255, 140 + f * 4);
      return [255, 40, 40, alpha];
    },
    getRadius: (d: any) => {
      const f = parseInt(d.fatalities) || 0;
      return Math.max(55000, f * 9000 + 55000);
    },
    radiusMinPixels: 4,
    radiusMaxPixels: 24,
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'conflict' } : null),
    updateTriggers: { getPosition: conflicts.length, getFillColor: conflicts.length },
  }), [conflicts]);

  // ─── Refineries Layer (⚗ alembic glyph, orange — OSM Overpass) ───
  const refineryLayer = useMemo(() => new TextLayer({
    id: 'refineries',
    data: refineries,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getText: () => '⚗',
    getSize: 12,
    getColor: [255, 140, 0, 230],
    fontFamily: 'sans-serif',
    characterSet: ['⚗'],
    sizeUnits: 'pixels',
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'refinery' } : null),
    updateTriggers: { getPosition: refineries.length },
  }), [refineries]);

  // ─── Mines Layer (⛏ pickaxe glyph, yellow — USGS MRDS) ───
  const mineLayer = useMemo(() => new TextLayer({
    id: 'mines',
    data: mines,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getText: () => '⛏',
    getSize: 11,
    getColor: [255, 200, 50, 220],
    fontFamily: 'sans-serif',
    characterSet: ['⛏'],
    sizeUnits: 'pixels',
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'mine' } : null),
    updateTriggers: { getPosition: mines.length },
  }), [mines]);

  // ─── Airports Layer (▲ unicode glyph, near-white) ───
  // Server thins to large hubs at zoom < 3, so the dot count stays sane
  // even at globe view. 10px is small enough not to overlap on continental
  // density but still readable on retina.
  const airportLayer = useMemo(() => new TextLayer({
    id: 'airports',
    data: airports,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getText: () => '▲',
    getSize: 10,
    getColor: [240, 240, 240, 220],
    fontFamily: 'sans-serif',
    characterSet: ['▲'],
    sizeUnits: 'pixels',
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'airport' } : null),
    updateTriggers: { getPosition: airports.length },
  }), [airports]);

  // ─── Ports Layer (⚓ unicode glyph, teal) ───
  // Same thinning approach: harbor_size='L' only at zoom < 3.
  const portLayer = useMemo(() => new TextLayer({
    id: 'ports',
    data: ports,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getText: () => '⚓',
    getSize: 10,
    getColor: [25, 208, 184, 220],
    fontFamily: 'sans-serif',
    characterSet: ['⚓'],
    sizeUnits: 'pixels',
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'port' } : null),
    updateTriggers: { getPosition: ports.length },
  }), [ports]);

  // ─── Power Plants — split into nuclear + non-nuclear ───
  // Non-nuclear (renewable + fossil) share the ⚡ glyph and differ only by
  // colour. Nuclear renders via a multi-colour atom IconLayer so the orbits
  // (turquoise) and electrons (yellow) come through.
  const { nuclearPlants, nonNuclearPlants } = useMemo(() => {
    const nuclear: any[] = [];
    const nonNuclear: any[] = [];
    for (const p of powerPlants) {
      if (p.fuel_type === 'nuclear') nuclear.push(p);
      else nonNuclear.push(p);
    }
    return { nuclearPlants: nuclear, nonNuclearPlants: nonNuclear };
  }, [powerPlants]);

  const powerPlantLayer = useMemo(() => new TextLayer({
    id: 'power-plants',
    data: nonNuclearPlants,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getText: () => '⚡',
    getSize: (d: any) => powerSize(d.capacity_mw),
    getColor: (d: any) => POWER_CATEGORY_COLOR[powerCategory(d.fuel_type)],
    fontFamily: 'sans-serif',
    characterSet: ['⚡'],
    sizeUnits: 'pixels',
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'power_plant' } : null),
    updateTriggers: {
      getPosition: nonNuclearPlants.length,
      getColor: nonNuclearPlants.length,
      getSize: nonNuclearPlants.length,
    },
  }), [nonNuclearPlants]);

  const nuclearLayer = useMemo(() => new IconLayer({
    id: 'power-plants-nuclear',
    data: nuclearPlants,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getIcon: () => NUCLEAR_ATOM_ICON,
    getSize: (d: any) => powerSize(d.capacity_mw) * 1.4, // atom needs a touch more pixel real-estate than ⚡ to read
    sizeUnits: 'pixels',
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'power_plant' } : null),
    updateTriggers: { getPosition: nuclearPlants.length, getSize: nuclearPlants.length },
  }), [nuclearPlants]);

  // ─── Pipelines (PathLayer) — split MultiLineString into one entry per
  // sub-line so the layer renders all routes uniformly. LNG terminals come
  // through the same `pipelines` prop tagged with infra_subtype, so we
  // partition the array first.
  const { pipelinePaths, lngTerminalPoints } = useMemo(() => {
    const paths: any[] = [];
    const points: any[] = [];
    for (const item of pipelines) {
      if (item.infra_subtype === 'lng_terminal') {
        points.push(item);
        continue;
      }
      const geom = item.route_geojson;
      if (!geom) continue;
      if (geom.type === 'LineString') {
        paths.push({ ...item, path: geom.coordinates });
      } else if (geom.type === 'MultiLineString') {
        for (const line of geom.coordinates) paths.push({ ...item, path: line });
      } else if (geom.type === 'GeometryCollection') {
        for (const inner of geom.geometries || []) {
          if (inner.type === 'LineString') paths.push({ ...item, path: inner.coordinates });
          else if (inner.type === 'MultiLineString') {
            for (const line of inner.coordinates) paths.push({ ...item, path: line });
          }
        }
      }
    }
    return { pipelinePaths: paths, lngTerminalPoints: points };
  }, [pipelines]);

  const pipelineLayer = useMemo(() => new PathLayer({
    id: 'gas-pipelines',
    data: pipelinePaths,
    getPath: (d: any) => d.path,
    getColor: PIPELINE_COLOR,
    getWidth: (d: any) => pipelineWidth(d.capacity_bcm_y),
    widthUnits: 'pixels',
    widthMinPixels: 1,
    widthMaxPixels: 4,
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'pipeline' } : null),
    updateTriggers: { getPath: pipelinePaths.length, getWidth: pipelinePaths.length },
  }), [pipelinePaths]);

  const lngTerminalLayer = useMemo(() => new TextLayer({
    id: 'lng-terminals',
    data: lngTerminalPoints,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getText: () => '⛁',
    getSize: (d: any) => terminalSize(d.capacity_mtpa),
    getColor: LNG_TERMINAL_COLOR,
    fontFamily: 'sans-serif',
    characterSet: ['⛁'],
    sizeUnits: 'pixels',
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'lng_terminal' } : null),
    updateTriggers: {
      getPosition: lngTerminalPoints.length,
      getSize: lngTerminalPoints.length,
    },
  }), [lngTerminalPoints]);

  // Pipelines render under everything else (lines as background); LNG
  // terminals sit alongside other point markers. Hover-pick order is
  // last → first, so terminals win over pipelines when overlapping.
  const layers = [pipelineLayer, vesselLayer, aircraftLayer, conflictLayer, refineryLayer, mineLayer, powerPlantLayer, nuclearLayer, airportLayer, portLayer, lngTerminalLayer];

  // ─── Tooltip Renderer ───
  const renderTooltip = useCallback(() => {
    if (!hoverInfo?.object) return null;
    const { x, y, object, type } = hoverInfo;

    let content: JSX.Element;
    switch (type) {
      case 'aircraft':
        content = (
          <div>
            <div className="font-semibold text-yellow-300">{object.callsign || object.flight || object.icao24}</div>
            <div className="text-xs text-gray-400 mt-0.5">{object.type || 'Aircraft'} {object.military ? '(Military)' : ''}</div>
            <div className="text-xs mt-1">Country: {object.country || object.origin_country || '—'}</div>
            <div className="text-xs">Alt: {object.altitude != null ? `${Math.round(object.altitude)} m` : '—'}</div>
            <div className="text-xs">Speed: {object.velocity != null ? `${Math.round(object.velocity * 1.944)} kts` : (object.gs ? `${Math.round(object.gs)} kts` : '—')}</div>
          </div>
        );
        break;
      case 'vessel':
        content = (
          <div>
            <div className="font-semibold text-blue-300">{object.name || object.NAME || 'Unknown Vessel'}</div>
            <div className="text-xs text-gray-400 mt-0.5">MMSI: {object.mmsi || object.MMSI}</div>
            <div className="text-xs mt-1">Speed: {(object.speed || object.SOG || 0).toFixed(1)} kts</div>
            <div className="text-xs">Heading: {object.heading || object.HEADING || '—'}</div>
            <div className="text-xs">Dest: {object.destination || object.DESTINATION || '—'}</div>
          </div>
        );
        break;
      case 'conflict':
        content = (
          <div>
            <div className="font-semibold text-red-300">{object.event_type}</div>
            <div className="text-xs text-gray-400 mt-0.5">{object.country} — {object.event_date}</div>
            <div className="text-xs mt-1">Actors: {object.actor1} {object.actor2 ? `vs ${object.actor2}` : ''}</div>
            <div className="text-xs">Fatalities: {object.fatalities || 0}</div>
            {object.notes && <div className="text-xs mt-1 text-gray-400 max-w-[250px] line-clamp-2">{object.notes}</div>}
          </div>
        );
        break;
      case 'refinery':
        content = (
          <div>
            <div className="font-semibold" style={{ color: 'rgb(255, 140, 0)' }}>
              {object.refinery_name || object.operator || 'Refinery'}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {object.product || 'oil refinery'}{object.country ? ` — ${object.country}` : (object.iso_country ? ` — ${object.iso_country}` : '')}
            </div>
            {object.capacity_bpd != null && (
              <div className="text-xs mt-1">Capacity: {Number(object.capacity_bpd).toLocaleString()} bpd</div>
            )}
            {object.operator && object.operator !== object.refinery_name && (
              <div className="text-xs">Operator: {object.operator}</div>
            )}
            {object.start_date && <div className="text-xs">Online since {object.start_date}</div>}
            {object.city && <div className="text-xs text-gray-400 mt-1">{object.city}</div>}
          </div>
        );
        break;
      case 'mine':
        content = (
          <div>
            <div className="font-semibold" style={{ color: 'rgb(255, 200, 50)' }}>
              {object.site_name || 'Mine'}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {object.commod1 || '—'}{object.dev_stat ? ` · ${object.dev_stat}` : ''}
            </div>
            {(object.commod2 || object.commod3) && (
              <div className="text-xs mt-1">
                Also: {[object.commod2, object.commod3].filter(Boolean).join(', ')}
              </div>
            )}
            {object.dep_type && <div className="text-xs">Type: {object.dep_type}</div>}
            {(object.country || object.state) && (
              <div className="text-xs text-gray-400 mt-1">
                {object.state ? `${object.state}, ` : ''}{object.country || object.iso_country || '—'}
              </div>
            )}
          </div>
        );
        break;
      case 'pipeline':
        content = (
          <div>
            <div className="font-semibold" style={{ color: 'rgb(255, 214, 165)' }}>{object.pipeline_name}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {object.segment_name ? `${object.segment_name} · ` : ''}{object.fuel || '—'}
              {object.route_accuracy ? ` · route ${object.route_accuracy}` : ''}
            </div>
            {object.capacity_bcm_y != null && (
              <div className="text-xs mt-1">Capacity: {Number(object.capacity_bcm_y).toFixed(1)} bcm/y</div>
            )}
            {object.length_km != null && (
              <div className="text-xs">Length: {Math.round(Number(object.length_km)).toLocaleString()} km</div>
            )}
            <div className="text-xs">Status: {object.status || '—'}</div>
            {object.start_year && <div className="text-xs">Online since {object.start_year}</div>}
            {(object.start_country || object.end_country) && (
              <div className="text-xs text-gray-400 mt-1">
                {object.start_country || '—'} → {object.end_country || '—'}
              </div>
            )}
            {object.owner && <div className="text-xs text-gray-400 max-w-[260px] truncate">{object.owner}</div>}
          </div>
        );
        break;
      case 'lng_terminal':
        content = (
          <div>
            <div className="font-semibold" style={{ color: 'rgb(255, 214, 165)' }}>{object.terminal_name}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {object.facility_type ? `${object.facility_type} terminal · ` : 'LNG terminal · '}{object.fuel || 'LNG'}
            </div>
            {object.capacity_mtpa != null && (
              <div className="text-xs mt-1">Capacity: {Number(object.capacity_mtpa).toFixed(1)} mtpa
                {object.capacity_bcm_y != null ? ` (${Number(object.capacity_bcm_y).toFixed(1)} bcm/y)` : ''}
              </div>
            )}
            <div className="text-xs">Status: {object.status || '—'}</div>
            {object.start_year && <div className="text-xs">Online since {object.start_year}</div>}
            {object.country && (
              <div className="text-xs text-gray-400 mt-1">{object.country}</div>
            )}
            {(object.offshore || object.floating) && (
              <div className="text-xs text-gray-400">
                {object.floating ? 'Floating' : object.offshore ? 'Offshore' : ''}
              </div>
            )}
            {object.operator && <div className="text-xs text-gray-400 max-w-[260px] truncate">{object.operator}</div>}
          </div>
        );
        break;
      case 'power_plant': {
        const cat = powerCategory(object.fuel_type);
        const [r, g, b] = POWER_CATEGORY_COLOR[cat];
        content = (
          <div>
            <div className="font-semibold" style={{ color: `rgb(${r}, ${g}, ${b})` }}>{object.plant_name}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {object.unit_name ? `Unit ${object.unit_name} · ` : ''}{object.fuel_type || '—'}
              {object.technology ? ` · ${object.technology}` : ''}
            </div>
            {object.capacity_mw != null && (
              <div className="text-xs mt-1">Capacity: {Number(object.capacity_mw).toLocaleString()} MW</div>
            )}
            <div className="text-xs">Status: {object.status || '—'}</div>
            {object.start_year && <div className="text-xs">Online since {object.start_year}</div>}
            {object.country && (
              <div className="text-xs text-gray-400 mt-1">
                {object.country}{object.subnational_unit ? ` · ${object.subnational_unit}` : ''}
              </div>
            )}
            {object.owner && <div className="text-xs text-gray-400 max-w-[260px] truncate">{object.owner}</div>}
          </div>
        );
        break;
      }
      case 'airport':
        content = (
          <div>
            <div className="font-semibold text-white">{object.name}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {(object.type || '').replace('_', ' ')} — {object.iso_country || '—'}
            </div>
            <div className="text-xs mt-1">
              {object.iata_code ? `IATA ${object.iata_code}` : ''}
              {object.iata_code && object.icao_code ? ' · ' : ''}
              {object.icao_code ? `ICAO ${object.icao_code}` : ''}
            </div>
            {object.municipality && <div className="text-xs">{object.municipality}</div>}
            {object.elevation_ft != null && (
              <div className="text-xs">Elev: {object.elevation_ft.toLocaleString()} ft</div>
            )}
            {object.scheduled_service && (
              <div className="text-xs text-gray-400">Scheduled service</div>
            )}
          </div>
        );
        break;
      case 'port':
        content = (
          <div>
            <div className="font-semibold text-teal-300">{object.port_name}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {object.country || '—'}{object.unlocode ? ` · ${object.unlocode}` : ''}
            </div>
            {object.harbor_size && (
              <div className="text-xs mt-1">
                Harbor: {object.harbor_size}
                {object.harbor_type ? ` · ${object.harbor_type}` : ''}
              </div>
            )}
            {object.shelter && <div className="text-xs">Shelter: {object.shelter}</div>}
            {object.channel_depth_m != null && (
              <div className="text-xs">Channel: {object.channel_depth_m} m</div>
            )}
          </div>
        );
        break;
      default:
        content = <div className="text-xs">Unknown</div>;
    }

    return (
      <div
        className="absolute z-50 pointer-events-none bg-eykon-card/95 backdrop-blur-sm border border-eykon-border rounded-lg px-3 py-2 shadow-xl"
        style={{ left: x + 12, top: y - 12, maxWidth: 300 }}
      >
        {content}
      </div>
    );
  }, [hoverInfo]);

  return (
    <div className="w-full h-full relative">
      <DeckGL
        viewState={viewState as any}
        onViewStateChange={handleViewStateChange}
        layers={layers}
        controller={true}
        getCursor={({ isHovering, isDragging }: any) =>
          isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
        }
      >
        <Map ref={mapRef} mapStyle={MAP_CONFIG.BASEMAP} onLoad={handleMapLoad} />
      </DeckGL>

      {renderTooltip()}
    </div>
  );
}
