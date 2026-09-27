/**
 * Webcams wave 1 (Imagery Layer IMG-5) — one fetcher per licence-clean
 * government source. Every endpoint and field below was read live on
 * 2026-09-26; counts are what each returned that night:
 *
 *   tfl_jamcams    TfL Unified API /Place/Type/JamCam          890 cameras
 *   hk_td          HK Transport Dept camera list (XML)         1,013
 *   sg_lta         data.gov.sg transport/traffic-images            8
 *   caltrans_cctv  cwwp2 cctvStatusD01..D12.json               ~3,600 (12 districts)
 *   usgs_ashcam    volcview AshCam API, faaInd = 'N' only        231
 *
 * Not in wave 1: Québec 511 — its open dataset (CC BY 4.0, 680 cameras)
 * links only to an HTML viewer page, not to an image; deriving the image
 * endpoint would be scraping. USGS cameras flagged faaInd = 'Y' are FAA
 * weather cameras and not covered by the USGS public-domain licence.
 *
 * A fetcher returns rows; it never decides liveness. A camera becomes live
 * only after a real fetch of its image (see liveness.ts, migration 187).
 */

export interface CamRow {
  provider_cam_id: string;
  name: string;
  latitude: number;
  longitude: number;
  heading_deg?: number | null;
  category: 'traffic' | 'port' | 'bridge' | 'border' | 'city' | 'coast' | 'mountain' | 'volcano' | 'weather' | 'other';
  media_type: 'image';
  upstream_url: string;
}

export type ProviderId = 'tfl_jamcams' | 'hk_td' | 'sg_lta' | 'caltrans_cctv' | 'usgs_ashcam';

const UA = { 'User-Agent': 'eYKON-webcams/1 (+https://eykon.ai)' };

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: UA, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const num = (v: unknown): number => (typeof v === 'number' ? v : parseFloat(String(v)));

const HEADINGS: Record<string, number> = {
  north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315,
};

async function tfl(): Promise<CamRow[]> {
  const list = (await getJson('https://api.tfl.gov.uk/Place/Type/JamCam')) as Array<any>;
  return list.flatMap(c => {
    const props = Object.fromEntries((c.additionalProperties ?? []).map((p: any) => [p.key, p.value]));
    if (props.available !== 'true' || !props.imageUrl) return [];
    return [{
      provider_cam_id: String(c.id),
      name: String(c.commonName ?? c.id),
      latitude: num(c.lat),
      longitude: num(c.lon),
      heading_deg: HEADINGS[String(props.view ?? '').toLowerCase().replace(/[^a-z]/g, '')] ?? null,
      category: 'traffic' as const,
      media_type: 'image' as const,
      upstream_url: String(props.imageUrl),
    }];
  });
}

async function hk(): Promise<CamRow[]> {
  const res = await fetch('https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml', {
    headers: UA, cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HK TD camera list: HTTP ${res.status}`);
  const xml = await res.text();
  const tag = (block: string, t: string) => block.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]?.trim() ?? '';
  return [...xml.matchAll(/<image>([\s\S]*?)<\/image>/g)].flatMap(m => {
    const b = m[1];
    const url = tag(b, 'url');
    if (!url) return [];
    return [{
      provider_cam_id: tag(b, 'key'),
      name: tag(b, 'description').replace(/&amp;/g, '&'),
      latitude: num(tag(b, 'latitude')),
      longitude: num(tag(b, 'longitude')),
      category: 'traffic' as const,
      media_type: 'image' as const,
      upstream_url: url,
    }];
  });
}

/** data.gov.sg image URLs change every refresh: the upstream is the API + camera id, resolved per request. */
export const SG_API = 'https://api.data.gov.sg/v1/transport/traffic-images';

async function sg(): Promise<CamRow[]> {
  const j = await getJson(SG_API);
  const cams: any[] = j?.items?.[0]?.cameras ?? [];
  return cams.map(c => ({
    provider_cam_id: String(c.camera_id),
    name: `Singapore traffic camera ${c.camera_id}`,
    latitude: num(c.location?.latitude),
    longitude: num(c.location?.longitude),
    category: 'traffic' as const,
    media_type: 'image' as const,
    upstream_url: `${SG_API}#camera=${encodeURIComponent(String(c.camera_id))}`,
  }));
}

/** Resolve the current image URL for one data.gov.sg camera. */
export async function resolveSgImage(upstream: string): Promise<string | null> {
  const id = decodeURIComponent(upstream.split('#camera=')[1] ?? '');
  if (!id) return null;
  const j = await getJson(SG_API);
  const cam = (j?.items?.[0]?.cameras ?? []).find((c: any) => String(c.camera_id) === id);
  return cam?.image ?? null;
}

const CALTRANS_DISTRICTS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

async function caltrans(): Promise<CamRow[]> {
  const out: CamRow[] = [];
  for (const d of CALTRANS_DISTRICTS) {
    const j = await getJson(`https://cwwp2.dot.ca.gov/data/d${Number(d)}/cctv/cctvStatusD${d}.json`);
    for (const row of j?.data ?? []) {
      const c = row.cctv;
      const url = c?.imageData?.static?.currentImageURL;
      if (!c || String(c.inService) !== 'true' || !url) continue;
      out.push({
        provider_cam_id: `D${d}-${c.index ?? c.location?.locationName}`,
        name: String(c.location?.locationName ?? `Caltrans D${d}`),
        latitude: num(c.location?.latitude),
        longitude: num(c.location?.longitude),
        category: 'traffic',
        media_type: 'image',
        upstream_url: String(url),
      });
    }
  }
  return out;
}

async function usgs(): Promise<CamRow[]> {
  const j = await getJson('https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams');
  const cams: any[] = j?.webcams ?? [];
  return cams
    .filter(c => c.faaInd === 'N' && c.currentImageUrl)
    .map(c => ({
      provider_cam_id: String(c.webcamCode),
      name: `${c.webcamName}${c.vName ? ` (${c.vName})` : ''}`,
      latitude: num(c.latitude),
      longitude: num(c.longitude),
      heading_deg: Number.isFinite(num(c.bearingDeg)) ? Math.round(num(c.bearingDeg)) % 360 : null,
      category: 'volcano' as const,
      media_type: 'image' as const,
      upstream_url: String(c.currentImageUrl),
    }));
}

export const PROVIDERS: Record<ProviderId, () => Promise<CamRow[]>> = {
  tfl_jamcams: tfl,
  hk_td: hk,
  sg_lta: sg,
  caltrans_cctv: caltrans,
  usgs_ashcam: usgs,
};
