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
  infrastructure: any[];
  airports: any[];
  ports: any[];
  /** Fired ~500ms after the user stops panning/zooming, with the visible bbox. */
  onViewportChange?: (bbox: BBox) => void;
}

const VIEWPORT_DEBOUNCE_MS = 500;

export default function MapView({
  aircraft,
  vessels,
  conflicts,
  infrastructure,
  airports,
  ports,
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

  // ─── Infrastructure Layer (Green/Teal icons by type) ───
  const infraLayer = useMemo(() => new ScatterplotLayer({
    id: 'infrastructure',
    data: infrastructure,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getFillColor: (d: any) => {
      const colors: Record<string, [number, number, number, number]> = {
        power_plant: [0, 200, 100, 200],
        refinery: [255, 140, 0, 200],
        pipeline: [100, 180, 255, 180],
        port: [0, 160, 255, 200],
        airport: [180, 130, 255, 200],
        mine: [255, 200, 50, 200],
      };
      return colors[d.infra_type] || [0, 200, 100, 200];
    },
    getRadius: 50000,
    radiusMinPixels: 4,
    radiusMaxPixels: 12,
    pickable: true,
    onHover: (info: any) => setHoverInfo(info.object ? { ...info, type: 'infrastructure' } : null),
    updateTriggers: { getPosition: infrastructure.length },
  }), [infrastructure]);

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

  const layers = [vesselLayer, aircraftLayer, conflictLayer, infraLayer, airportLayer, portLayer];

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
      case 'infrastructure':
        content = (
          <div>
            <div className="font-semibold text-green-300">{object.name}</div>
            <div className="text-xs text-gray-400 mt-0.5">{object.infra_type} — {object.country}</div>
            {object.fuel_type && <div className="text-xs mt-1">Fuel: {object.fuel_type}</div>}
            {object.capacity_mw > 0 && <div className="text-xs">Capacity: {object.capacity_mw.toLocaleString()} MW</div>}
            <div className="text-xs">Status: {object.status}</div>
          </div>
        );
        break;
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
              {object.country_code || '—'}{object.unlocode ? ` · ${object.unlocode}` : ''}
            </div>
            {object.harbor_size && (
              <div className="text-xs mt-1">
                Harbor: {{ L: 'Large', M: 'Medium', S: 'Small', V: 'Very small' }[object.harbor_size as 'L'|'M'|'S'|'V'] || object.harbor_size}
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
