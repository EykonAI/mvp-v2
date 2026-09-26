/**
 * Context imagery (Imagery Layer IMG-4) — NASA GIBS rasters drawn UNDER the
 * globe's data layers. Context only: nothing reads a pixel of these, nothing
 * scores or alerts on them. They answer "what did the sky look like?" beside
 * a FIRMS or Black Marble VOID, a cloudy Sentinel-2 look, or a quiet AIS box.
 *
 * Every layer here was read from the live GIBS WMTS capabilities
 * (epsg3857/best, 2026-09-26): identifier, tile-matrix set, format and time
 * step. The time shown is always the image time from GIBS, never "now".
 *
 * Licence: NASA GIBS imagery — no restriction on commercial use; required
 * acknowledgement below; no implied NASA endorsement (feed register B03/B05).
 * The GIBS night-lights raster stays deferred (brief §17.3): it would paint
 * coverage the Black Marble sampling does not have. True colour and
 * geostationary cloud imagery are different decisions (build prompt F-3).
 */

export type ContextLayerId = 'viirs_truecolor' | 'goes_east_geocolor' | 'goes_west_geocolor' | 'himawari_ir';

export interface ContextLayerDef {
  id: ContextLayerId;
  /** Globe sub-layer key that switches it on. */
  sublayer: 'imagery.truecolor' | 'imagery.geostationary';
  label: string;
  gibsLayer: string;
  tileMatrixSet: string;
  /** Deepest zoom GIBS serves for this tile-matrix set. */
  maxZoom: number;
  ext: 'jpeg' | 'png';
  cadence: 'P1D' | 'PT10M';
  /** What the picture is — and is not. Shown in the legend. */
  whatItIs: string;
}

export const GIBS_WMTS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const GIBS_CREDIT =
  "Imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's ESDIS";

export const CONTEXT_LAYERS: ContextLayerDef[] = [
  {
    id: 'viirs_truecolor',
    sublayer: 'imagery.truecolor',
    label: 'Daily true colour · VIIRS NOAA-20',
    gibsLayer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maxZoom: 9,
    ext: 'jpeg',
    cadence: 'P1D',
    whatItIs: 'Daytime passes stitched into one picture per UTC day (~375 m). Today fills in as passes arrive; night-side areas are dark. A picture, not a measurement.',
  },
  {
    id: 'goes_east_geocolor',
    sublayer: 'imagery.geostationary',
    label: 'GOES-East GeoColor · Americas / Atlantic',
    gibsLayer: 'GOES-East_ABI_GeoColor',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maxZoom: 7,
    ext: 'png',
    cadence: 'PT10M',
    whatItIs: 'Geostationary image every 10 min (~1–2 km). Clouds and smoke, not ground detail. A picture, not a measurement.',
  },
  {
    id: 'goes_west_geocolor',
    sublayer: 'imagery.geostationary',
    label: 'GOES-West GeoColor · Pacific / western Americas',
    gibsLayer: 'GOES-West_ABI_GeoColor',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maxZoom: 7,
    ext: 'png',
    cadence: 'PT10M',
    whatItIs: 'Geostationary image every 10 min (~1–2 km). Clouds and smoke, not ground detail. A picture, not a measurement.',
  },
  {
    id: 'himawari_ir',
    sublayer: 'imagery.geostationary',
    label: 'Himawari clean infrared · Asia / western Pacific',
    gibsLayer: 'Himawari_AHI_Band13_Clean_Infrared',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    ext: 'png',
    cadence: 'PT10M',
    whatItIs: 'Infrared (cloud-top temperature) every 10 min, day and night — not a photograph. GIBS serves no Himawari true colour.',
  },
];

/** Tile URL template for one layer at one GIBS time, deck.gl {z}/{x}/{y} order. */
export function gibsTileUrl(def: ContextLayerDef, time: string): string {
  return `${GIBS_WMTS_BASE}/${def.gibsLayer}/default/${encodeURIComponent(time)}/${def.tileMatrixSet}/{z}/{y}/{x}.${def.ext}`;
}

export interface ContextLayerState {
  id: ContextLayerId;
  /** Newest image time GIBS advertises (ISO timestamp, or YYYY-MM-DD for daily). */
  time: string | null;
  /** True when a daily image is for the current UTC day, i.e. still filling in. */
  partial: boolean;
}

/** The <Default> time inside one layer's block of the capabilities XML. */
export function defaultTimeFor(xml: string, gibsLayer: string): string | null {
  const marker = `<ows:Identifier>${gibsLayer}</ows:Identifier>`;
  const i = xml.indexOf(marker);
  if (i < 0) return null;
  const end = xml.indexOf('</Layer>', i);
  const block = xml.slice(i, end < 0 ? undefined : end);
  const m = block.match(/<Default>([^<]+)<\/Default>/);
  return m ? m[1].trim() : null;
}

export function toStates(xml: string, now = new Date()): ContextLayerState[] {
  const today = now.toISOString().slice(0, 10);
  return CONTEXT_LAYERS.map(def => {
    const time = defaultTimeFor(xml, def.gibsLayer);
    return { id: def.id, time, partial: def.cadence === 'P1D' && time === today };
  });
}
