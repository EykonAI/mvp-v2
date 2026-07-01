'use client';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_CONFIG } from '@/lib/constants';

export interface MiniMapBbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

// A small, non-interactive locator map for a convergence event — the app's
// CARTO dark-matter basemap (MAP_CONFIG.BASEMAP, the same the globe uses),
// centred on the event with its bounding box drawn. Client-only (maplibre
// needs the DOM); rendered from the force-dynamic detail page.
export function MiniMap({
  lat,
  lon,
  bbox,
  height = 260,
}: {
  lat: number;
  lon: number;
  bbox?: MiniMapBbox | null;
  height?: number;
}) {
  const poly = bbox
    ? {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [bbox.lonMin, bbox.latMin],
              [bbox.lonMax, bbox.latMin],
              [bbox.lonMax, bbox.latMax],
              [bbox.lonMin, bbox.latMax],
              [bbox.lonMin, bbox.latMin],
            ],
          ],
        },
      }
    : null;

  return (
    <div style={{ height, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--rule-soft)' }}>
      <Map
        initialViewState={{ longitude: lon, latitude: lat, zoom: 3 }}
        mapStyle={MAP_CONFIG.BASEMAP}
        interactive={false}
        style={{ width: '100%', height: '100%' }}
      >
        {poly && (
          <Source id="conv-bbox" type="geojson" data={poly}>
            <Layer id="conv-bbox-fill" type="fill" paint={{ 'fill-color': '#8b5cf6', 'fill-opacity': 0.15 }} />
            <Layer id="conv-bbox-line" type="line" paint={{ 'line-color': '#8b5cf6', 'line-width': 1.5 }} />
          </Source>
        )}
        <Marker longitude={lon} latitude={lat}>
          <span
            style={{
              display: 'block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#8b5cf6',
              boxShadow: '0 0 0 3px rgba(139,92,246,0.35)',
            }}
          />
        </Marker>
      </Map>
    </div>
  );
}
