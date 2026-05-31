import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';

// GDELT energy-infrastructure EVENT ingest · every 15 min.
//
// Pulls the latest GDELT 2.0 GKG export and keeps only rows that are,
// with high confidence, an INCIDENT at energy/infra. A row is ingested
// iff it carries BOTH:
//   (a) an energy/infra ANCHOR theme        -> infrastructure_type
//   (b) a high-confidence INCIDENT theme     -> event_type
// and is dropped otherwise. Output lands in infrastructure_events
// (migration 045), backing the InfrastructureEvents notification
// bucket and the PR 4 per-country energy anomaly detector.
//
// WHY precision-first: GKG themes are DOCUMENT-level, so theme
// co-occurrence does NOT mean the article is about an attack ON an
// energy asset (an oil-price article that also mentions a war zone
// trips ENV_OIL + KILL without either being causally linked). We
// therefore (1) require a real anchor theme rather than inferring
// infra from tone, and (2) admit only specific, low-false-positive
// incident themes — KILL / ARMEDCONFLICT / STRIKE / PROTEST /
// SANCTIONS / bare BLOCKADE are deliberately EXCLUDED as too
// promiscuous at the document level. Validated at ~80% precision /
// ~15 rows per cycle against live GKG.
//
// NB the GDELT energy theme strings in older internal docs
// (ECON_OIL / ECON_GAS / ECON_MINING / ECON_ENERGY / INFRASTRUCTURE)
// do not exist in the live GKG vocabulary; the constants below are the
// empirically-present World Bank (WB_*) and ENV_/ECON_ themes.
//
// Auth: Bearer <CRON_SECRET>. Recommended Railway schedule: */15.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LASTUPDATE_URL = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';

// GDELT 2.0 GKG column indexes (0-based), per the GKG 2.1 codebook.
const COL = {
  GKGRECORDID: 0, // "YYYYMMDDHHMMSS-N"
  DATE: 1,
  DOCUMENT_IDENTIFIER: 4, // source URL
  V2THEMES: 8, // "THEME,charOffset;THEME,charOffset;…"
  V2LOCATIONS: 10, // "type#fullName#countryFIPS#adm1#adm2#lat#lon#featureID#charOffset;…"
  V2TONE: 15, // "avgTone,posScore,negScore,polarity,…"
  EXTRAS: 26, // XML; carries <PAGE_TITLE>…</PAGE_TITLE>
} as const;

// ─── Infrastructure anchor themes (first match wins) ──────────
// Presence of ≥1 of a tier's themes classifies infrastructure_type.
// Order matters: a row with both a pipeline and a refinery theme is
// classified as the more specific pipeline.
const INFRA_THEME_MAP: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['pipeline', ['WB_2299_PIPELINES', 'PIPELINE_INCIDENT', 'ENV_NATURALGAS', 'ENV_GAS']],
  ['refinery', ['WB_2298_REFINERIES', 'ENV_OIL', 'ECON_OILPRICE', 'ECON_HEATINGOIL', 'WB_548_PPP_IN_OIL_AND_GAS', 'WB_539_OIL_AND_GAS_POLICY_STRATEGY_AND_INSTITUTIONS']],
  ['mine', ['WB_895_MINING_SYSTEMS', 'WB_1699_METAL_ORE_MINING', 'WB_1700_NONMETALLIC_MINERAL_MINING_AND_QUARRYING', 'ENV_MINING']],
  ['power_plant', ['WB_508_POWER_SYSTEMS', 'ENV_NUCLEARPOWER', 'WB_509_NUCLEAR_ENERGY', 'MANMADE_DISASTER_NUCLEAR_ACCIDENT', 'ECON_ELECTRICALGENERATION', 'ECON_ELECTRICALDEMAND', 'ECON_ELECTRICALLOADSHEDDING', 'POWER_OUTAGE', 'MANMADE_DISASTER_POWER_OUTAGES', 'WB_525_RENEWABLE_ENERGY', 'WB_528_SOLAR_ENERGY', 'ENV_WINDPOWER']],
  ['other', ['WB_507_ENERGY_AND_EXTRACTIVES', 'FUELPRICES', 'ECON_GASOLINEPRICE']],
];

// ─── Incident themes (≥1 required; first match sets event_type) ─
const ATTACK_THEMES = ['BOMBING', 'MILITARY_ATTACK', 'TERROR', 'SUICIDE_ATTACK'];
const ACCIDENT_THEMES = ['PIPELINE_INCIDENT', 'MANMADE_DISASTER_NUCLEAR_ACCIDENT'];
const SHUTDOWN_THEMES = ['POWER_OUTAGE', 'MANMADE_DISASTER_POWER_OUTAGES', 'ECON_ELECTRICALLOADSHEDDING', 'MILITARY_BLOCKADE'];
// severity=high when any of these fire; everything kept is otherwise medium.
const HIGH_SEV_THEMES = ['BOMBING', 'MILITARY_ATTACK', 'TERROR', 'SUICIDE_ATTACK', 'MANMADE_DISASTER_NUCLEAR_ACCIDENT'];

// Flat vocabulary we recognise — used to store only the themes that
// actually drove classification (keeps the themes[] column bounded and
// debuggable rather than dumping all ~50 raw document themes).
const KNOWN_THEMES: ReadonlySet<string> = new Set([
  ...INFRA_THEME_MAP.flatMap(([, themes]) => themes),
  ...ATTACK_THEMES,
  ...ACCIDENT_THEMES,
  ...SHUTDOWN_THEMES,
]);

type EventType = 'attack' | 'accident' | 'shutdown';
type Severity = 'low' | 'medium' | 'high';

const hasAny = (set: ReadonlySet<string>, arr: readonly string[]): boolean =>
  arr.some((t) => set.has(t));

function classifyInfra(set: ReadonlySet<string>): string | null {
  for (const [type, themes] of INFRA_THEME_MAP) if (hasAny(set, themes)) return type;
  return null;
}

function classifyEvent(set: ReadonlySet<string>): EventType | null {
  if (hasAny(set, ATTACK_THEMES)) return 'attack';
  if (hasAny(set, ACCIDENT_THEMES)) return 'accident';
  if (hasAny(set, SHUTDOWN_THEMES)) return 'shutdown';
  return null;
}

const severityOf = (set: ReadonlySet<string>): Severity =>
  hasAny(set, HIGH_SEV_THEMES) ? 'high' : 'medium';

function pageTitle(extras: string | undefined): string | null {
  const m = /<PAGE_TITLE>(.*?)<\/PAGE_TITLE>/i.exec(extras || '');
  return m ? m[1].trim() || null : null;
}

// First V2Locations entry → { country (FIPS 10-4), lat, lon }.
function firstLocation(v2locations: string | undefined): {
  country: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  const first = (v2locations || '').split(';')[0];
  if (!first) return { country: null, latitude: null, longitude: null };
  const p = first.split('#');
  const lat = parseFloat(p[5] ?? '');
  const lon = parseFloat(p[6] ?? '');
  return {
    country: (p[2] || '').trim() || null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
  };
}

interface InfraEventRow {
  gkg_record_id: string;
  event_id: string | null;
  event_type: EventType;
  infrastructure_type: string;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  severity: Severity;
  tone: number | null;
  num_mentions: number | null;
  source_urls: string[];
  themes: string[];
  title: string | null;
}

async function resolveLatestGkgUrl(): Promise<string> {
  const res = await fetch(LASTUPDATE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`lastupdate.txt HTTP ${res.status}`);
  const text = await res.text();
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.includes('.gkg.csv.zip'));
  if (!line) throw new Error('no gkg line in lastupdate.txt');
  const url = line.split(/\s+/).pop();
  if (!url) throw new Error('could not parse gkg URL');
  return url;
}

async function downloadZip(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`download HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function extractCsv(zipBuf: Buffer): string {
  const entry = new AdmZip(zipBuf)
    .getEntries()
    .find((e) => /\.csv$/i.test(e.entryName));
  if (!entry) throw new Error('no CSV entry in gkg zip');
  return entry.getData().toString('utf8');
}

function parseGkg(csv: string): InfraEventRow[] {
  const rows: InfraEventRow[] = [];
  for (const line of csv.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f.length < 16) continue; // need at least through V2Tone

    const id = f[COL.GKGRECORDID];
    if (!id) continue;

    const themeSet: ReadonlySet<string> = new Set(
      (f[COL.V2THEMES] || '')
        .split(';')
        .map((t) => t.split(',')[0])
        .filter(Boolean),
    );

    const infrastructure_type = classifyInfra(themeSet);
    if (!infrastructure_type) continue; // no energy/infra anchor → drop
    const event_type = classifyEvent(themeSet);
    if (!event_type) continue; // no high-confidence incident → drop

    const { country, latitude, longitude } = firstLocation(f[COL.V2LOCATIONS]);
    const toneRaw = parseFloat((f[COL.V2TONE] || '').split(',')[0]);
    const url = (f[COL.DOCUMENT_IDENTIFIER] || '').trim();

    rows.push({
      gkg_record_id: id,
      event_id: null, // GKG-only v1; reserved for a future GDELT Events join
      event_type,
      infrastructure_type,
      country,
      latitude,
      longitude,
      severity: severityOf(themeSet),
      tone: Number.isFinite(toneRaw) ? Number(toneRaw.toFixed(3)) : null,
      num_mentions: null, // not carried per-record in GKG
      source_urls: url ? [url] : [],
      themes: [...themeSet].filter((t) => KNOWN_THEMES.has(t)),
      title: pageTitle(f[COL.EXTRAS]),
    });
  }
  return rows;
}

async function upsertInChunks(rows: InfraEventRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = createServerSupabase();
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from('infrastructure_events')
      .upsert(batch, {
        onConflict: 'gkg_record_id',
        ignoreDuplicates: true,
        count: 'exact',
      });
    if (error) throw new Error(`supabase upsert: ${error.message}`);
    inserted += count ?? 0;
  }
  return inserted;
}

async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const startedAt = Date.now();
  try {
    const gkgUrl = await resolveLatestGkgUrl();
    const csv = extractCsv(await downloadZip(gkgUrl));
    const rows = parseGkg(csv);
    const inserted = await upsertInChunks(rows);

    return NextResponse.json({
      ok: true,
      source_url: gkgUrl,
      kept: rows.length,
      inserted,
      elapsed_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err), elapsed_ms: Date.now() - startedAt },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
