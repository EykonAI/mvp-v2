import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

// One-shot ingestion of oil-refinery POIs from OpenStreetMap via the
// Overpass API. Free, no key, global coverage (~1,000–1,500 features
// at the time of writing). Default endpoint is the Kumi mirror —
// Austrian non-profit, no rate limits per the 2026-Q2 provider deltas.
//
// Mirrors the GEM cron auth + chunking shape so Railway scheduling can
// reuse the same Bearer-token convention.
//
// Auth: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// Refinery-only tags. See seed-osm-refineries.mjs for the rationale —
// the earlier broader query (industrial=oil + man_made=works) returned
// ~125k features mostly composed of oilfields, vegetable-oil mills, and
// paint factories, not refineries.
const OVERPASS_QUERY = `
[out:json][timeout:180];
(
  nwr["man_made"="petroleum_refinery"];
  nwr["industrial"="oil_refinery"];
  nwr["industrial"="refinery"];
);
out center tags;
`.trim();

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
function checkAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const qs = req.nextUrl.searchParams.get('secret') || '';
  return bearer === expected || qs === expected;
}

function pickStr(tags: any, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = tags?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}
function pickNum(tags: any, ...keys: string[]): number | null {
  const s = pickStr(tags, ...keys);
  if (s === null) return null;
  const n = parseFloat(String(s).replace(/[^\d.\-eE]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function centroidOf(el: any): [number, number] | null {
  if (el.type === 'node') return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  return null;
}

function rowFromElement(el: any) {
  const tags = el.tags || {};
  const c = centroidOf(el);
  if (!c) return null;
  const [lat, lon] = c;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const wikidata = pickStr(tags, 'wikidata');
  const wikipedia = pickStr(tags, 'wikipedia');
  const wiki_url = wikidata
    ? `https://www.wikidata.org/wiki/${wikidata}`
    : wikipedia
      ? `https://${wikipedia.includes(':') ? wikipedia.split(':')[0] : 'en'}.wikipedia.org/wiki/${encodeURIComponent(
          wikipedia.includes(':') ? wikipedia.split(':').slice(1).join(':') : wikipedia,
        )}`
      : null;
  return {
    id: `${el.type}:${el.id}`,
    osm_type: el.type,
    osm_id: el.id,
    refinery_name: pickStr(tags, 'name:en', 'name', 'official_name', 'operator'),
    operator: pickStr(tags, 'operator'),
    owner: pickStr(tags, 'owner'),
    product: pickStr(tags, 'product'),
    capacity_bpd: pickNum(tags, 'capacity:bpd', 'capacity_bpd'),
    start_date: pickStr(tags, 'start_date', 'opening_date'),
    country: pickStr(tags, 'addr:country', 'is_in:country'),
    iso_country: pickStr(tags, 'ISO3166-1', 'addr:country_code'),
    city: pickStr(tags, 'addr:city', 'is_in:city'),
    wiki_url,
    source_tags: tags,
    latitude: lat,
    longitude: lon,
  };
}

async function handle(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const startedAt = Date.now();
  try {
    const url = process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL;
    // Overpass mirrors return HTTP 429 to clients without a meaningful
    // User-Agent. Identifies our project + provides a contact route.
    const userAgent = process.env.OVERPASS_USER_AGENT
      || 'eYKON.ai/1.0 (geopolitical intelligence platform; https://eykon.ai)';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
      body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const json = await res.json();
    const elements = json.elements || [];
    if (elements.length === 0) throw new Error('Overpass returned no elements');

    const byId = new Map<string, any>();
    let skipped = 0;
    for (const el of elements) {
      const row = rowFromElement(el);
      if (row) byId.set(row.id, row); else skipped++;
    }
    const rows = Array.from(byId.values());

    const supabase = createServerSupabase();
    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from('refineries')
        .upsert(batch, { onConflict: 'id', count: 'exact' });
      if (error) throw new Error(`supabase upsert (chunk ${i}): ${error.message}`);
      upserted += count ?? batch.length;
    }

    return NextResponse.json({
      ok: true,
      source_url: url,
      fetched: elements.length,
      parsed: rows.length,
      skipped,
      upserted,
      elapsed_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message, elapsed_ms: Date.now() - startedAt },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
