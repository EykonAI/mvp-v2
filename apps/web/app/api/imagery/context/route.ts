import { NextResponse } from 'next/server';
import {
  CONTEXT_LAYERS,
  GIBS_CREDIT,
  GIBS_WMTS_BASE,
  gibsTileUrl,
  toStates,
  type ContextLayerState,
} from '@/lib/imagery/context-layers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Context imagery times (Imagery Layer IMG-4).
 *
 * Reads the GIBS WMTS capabilities and returns, for each context layer, the
 * newest image time GIBS advertises (the layer's <Default> time) and the tile
 * template for exactly that time. The client never requests "latest": it
 * requests a named time and prints it, so the globe never implies "now".
 *
 * The capabilities document is ~6 MB, so it is read at most every 10 minutes
 * (the geostationary cadence) and held in this instance's memory. If GIBS is
 * unreachable, the last good answer is served with `stale: true` and its
 * age; with no good answer yet, every time is null and the client draws
 * nothing — a missing time is never guessed.
 */

const CAPABILITIES_URL = `${GIBS_WMTS_BASE}/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities`;
const TTL_MS = 10 * 60 * 1000;

let cache: { at: number; layers: ContextLayerState[] } | null = null;

export async function GET() {
  let stale = false;
  let error: string | null = null;

  if (!cache || Date.now() - cache.at > TTL_MS) {
    try {
      const res = await fetch(CAPABILITIES_URL, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`GIBS capabilities: HTTP ${res.status}`);
      const xml = await res.text();
      const layers = toStates(xml);
      if (layers.every(l => l.time === null)) throw new Error('GIBS capabilities: none of the context layers was found');
      cache = { at: Date.now(), layers };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      stale = cache !== null;
    }
  }

  const layers = (cache?.layers ?? CONTEXT_LAYERS.map(d => ({ id: d.id, time: null, partial: false }))).map(s => {
    const def = CONTEXT_LAYERS.find(d => d.id === s.id)!;
    return {
      ...s,
      label: def.label,
      sublayer: def.sublayer,
      what_it_is: def.whatItIs,
      max_zoom: def.maxZoom,
      cadence: def.cadence,
      tile_url: s.time ? gibsTileUrl(def, s.time) : null,
    };
  });

  return NextResponse.json(
    {
      layers,
      credit: GIBS_CREDIT,
      read_at: cache ? new Date(cache.at).toISOString() : null,
      stale,
      error,
      note: 'Context imagery: pictures at the stated time, never a measurement. Nothing on the platform reads these pixels.',
    },
    { status: cache ? 200 : 502 },
  );
}
