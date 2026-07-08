import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireCronSecret } from '@/lib/intel/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FETCH_PAGE = 1000;
const WRITE_CHUNK = 400;

// Safety caps per tick — the full SDN vessel set is ~1.5k vessels + ~550
// linked orgs, so these only bite if the source data balloons unexpectedly.
const MAX_ENTITY_WRITES = 3000;
const MAX_EDGE_WRITES = 6000;

// Only orgs linked to 2..25 vessels produce sibling_vessel cliques — orgs
// above the band (IRISL ~121, Sovcomflot ~81) would create megaclusters.
const SIBLING_MIN = 2;
const SIBLING_MAX = 25;

interface SdnVessel {
  ent_num: number;
  sdn_name: string;
  programs: string[] | null;
  remarks: string | null;
}

interface EntityRow {
  id: string;
  entity_type: string;
  canonical_name: string;
  metadata: Record<string, unknown> | null;
}

interface EdgeRow {
  source_entity_id: string;
  target_entity_id: string;
  edge_type: string;
}

/**
 * Entity-graph builder · weekly.
 *
 * Materialises the `entities` + `fleet_kinship_edges` graph from the
 * `ofac_designations` snapshot (refreshed daily by cron-ingest-ofac-sdn):
 *
 *   • active SDN vessels            → entities(entity_type 'vessel',
 *       metadata {ent_num, imo, programs}, provenance ['ofac_sdn'])
 *   • "Linked To: X" remark clauses → entities(entity_type 'organization',
 *       provenance ['ofac_sdn_linked']) + a vessel→org edge
 *   • vessels sharing a linked org  → vessel↔vessel sibling edges
 *       (only for orgs with 2..25 linked vessels)
 *
 * Edge types must satisfy the migration-004 CHECK constraint, so the
 * OFAC semantics map onto the existing vocabulary:
 *   vessel → linked org   = 'vessel_operator'  (source 'ofac_sdn_remarks')
 *   vessel ↔ vessel       = 'sibling_vessel'   (source 'ofac_sdn_shared_link')
 *
 * Idempotent: entities are matched by metadata->>'ent_num' (vessels) or
 * normalised canonical_name (orgs); edges are deduped in code by
 * (source, target, edge_type). A clean replay is a no-op.
 *
 * Auth: Bearer <CRON_SECRET>. Recommended Railway schedule: weekly,
 * 03:00 UTC Monday (after the daily SDN ingest has run).
 */
async function handle(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const startedAt = Date.now();
  const supabase = createServerSupabase();
  const errors: Array<{ stage: string; error: string }> = [];

  // ── 1 · Load active SDN vessels ────────────────────────────
  let vessels: SdnVessel[];
  try {
    vessels = await fetchAll<SdnVessel>(async (from, to) => {
      const { data, error } = await supabase
        .from('ofac_designations')
        .select('ent_num, sdn_name, programs, remarks')
        .eq('sdn_type', 'vessel')
        .is('removed_at', null)
        .order('ent_num', { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as SdnVessel[];
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, stage: 'load_sdn', error: msg(err), elapsed_ms: Date.now() - startedAt },
      { status: 500 },
    );
  }

  // ── 2 · Parse remarks: IMO + Linked To targets ─────────────
  const parsed = vessels.map(v => ({
    ...v,
    imo: extractImo(v.remarks),
    linkedOrgs: extractLinkedTo(v.remarks),
  }));

  // ── 3 · Snapshot existing entities + edges ─────────────────
  let existing: EntityRow[];
  let existingEdges: EdgeRow[];
  try {
    existing = await fetchAll<EntityRow>(async (from, to) => {
      const { data, error } = await supabase
        .from('entities')
        .select('id, entity_type, canonical_name, metadata')
        .order('created_at', { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as EntityRow[];
    });
    existingEdges = await fetchAll<EdgeRow>(async (from, to) => {
      const { data, error } = await supabase
        .from('fleet_kinship_edges')
        .select('source_entity_id, target_entity_id, edge_type')
        .order('id', { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as EdgeRow[];
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, stage: 'snapshot', error: msg(err), elapsed_ms: Date.now() - startedAt },
      { status: 500 },
    );
  }

  const vesselByEntNum = new Map<number, EntityRow>();
  const orgByName = new Map<string, EntityRow>();
  for (const e of existing) {
    const entNum = Number((e.metadata as Record<string, unknown> | null)?.ent_num);
    if (e.entity_type === 'vessel' && Number.isFinite(entNum)) vesselByEntNum.set(entNum, e);
    if (e.entity_type === 'organization') orgByName.set(normName(e.canonical_name), e);
  }

  let vessels_upserted = 0;
  let orgs_upserted = 0;
  let skipped_existing = 0;
  let entityWrites = 0;

  // ── 4 · Upsert vessels (insert missing, update changed) ────
  const vesselInserts: Array<Record<string, unknown>> = [];
  const vesselUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  for (const v of parsed) {
    const metadata = { ent_num: v.ent_num, imo: v.imo, programs: v.programs ?? [] };
    const ex = vesselByEntNum.get(v.ent_num);
    if (!ex) {
      vesselInserts.push({
        entity_type: 'vessel',
        canonical_name: v.sdn_name,
        metadata,
        provenance: ['ofac_sdn'],
      });
    } else if (
      ex.canonical_name !== v.sdn_name ||
      (ex.metadata as Record<string, unknown> | null)?.imo !== v.imo ||
      JSON.stringify((ex.metadata as Record<string, unknown> | null)?.programs ?? []) !==
        JSON.stringify(v.programs ?? [])
    ) {
      vesselUpdates.push({ id: ex.id, patch: { canonical_name: v.sdn_name, metadata } });
    } else {
      skipped_existing++;
    }
  }

  for (const chunk of chunked(vesselInserts, WRITE_CHUNK)) {
    if (entityWrites >= MAX_ENTITY_WRITES) break;
    const { data, error } = await supabase
      .from('entities')
      .insert(chunk)
      .select('id, entity_type, canonical_name, metadata');
    if (error) {
      errors.push({ stage: 'insert_vessels', error: error.message });
      continue;
    }
    for (const row of (data ?? []) as EntityRow[]) {
      const entNum = Number((row.metadata as Record<string, unknown> | null)?.ent_num);
      if (Number.isFinite(entNum)) vesselByEntNum.set(entNum, row);
    }
    vessels_upserted += chunk.length;
    entityWrites += chunk.length;
  }
  for (const u of vesselUpdates) {
    if (entityWrites >= MAX_ENTITY_WRITES) break;
    const { error } = await supabase.from('entities').update(u.patch).eq('id', u.id);
    if (error) errors.push({ stage: 'update_vessel', error: error.message });
    else {
      vessels_upserted++;
      entityWrites++;
    }
  }

  // ── 5 · Upsert linked-to organizations ─────────────────────
  const orgNames = new Map<string, string>(); // normName → display name
  for (const v of parsed) {
    for (const org of v.linkedOrgs) {
      const key = normName(org);
      if (!orgNames.has(key)) orgNames.set(key, org);
    }
  }
  const orgInserts: Array<Record<string, unknown>> = [];
  for (const [key, display] of orgNames) {
    if (orgByName.has(key)) skipped_existing++;
    else orgInserts.push({
      entity_type: 'organization',
      canonical_name: display,
      metadata: {},
      provenance: ['ofac_sdn_linked'],
    });
  }
  for (const chunk of chunked(orgInserts, WRITE_CHUNK)) {
    if (entityWrites >= MAX_ENTITY_WRITES) break;
    const { data, error } = await supabase
      .from('entities')
      .insert(chunk)
      .select('id, entity_type, canonical_name, metadata');
    if (error) {
      errors.push({ stage: 'insert_orgs', error: error.message });
      continue;
    }
    for (const row of (data ?? []) as EntityRow[]) orgByName.set(normName(row.canonical_name), row);
    orgs_upserted += chunk.length;
    entityWrites += chunk.length;
  }

  // ── 6 · Edges ──────────────────────────────────────────────
  const edgeSeen = new Set<string>();
  for (const e of existingEdges) {
    edgeSeen.add(`${e.source_entity_id}|${e.target_entity_id}|${e.edge_type}`);
  }
  const edgeInserts: Array<Record<string, unknown>> = [];
  const pushEdge = (source: string, target: string, type: string, weight: number, src: string) => {
    const key = `${source}|${target}|${type}`;
    if (edgeSeen.has(key)) {
      skipped_existing++;
      return;
    }
    edgeSeen.add(key);
    edgeInserts.push({
      source_entity_id: source,
      target_entity_id: target,
      edge_type: type,
      weight,
      source: src,
      valid_from: new Date().toISOString(),
    });
  };

  // vessel → linked org ('Linked To' in SDN remarks ≈ operator/owner)
  const vesselsPerOrg = new Map<string, string[]>(); // org entity id → vessel entity ids
  for (const v of parsed) {
    const vesselEntity = vesselByEntNum.get(v.ent_num);
    if (!vesselEntity) continue;
    for (const org of v.linkedOrgs) {
      const orgEntity = orgByName.get(normName(org));
      if (!orgEntity) continue;
      pushEdge(vesselEntity.id, orgEntity.id, 'vessel_operator', 1.0, 'ofac_sdn_remarks');
      const list = vesselsPerOrg.get(orgEntity.id) ?? [];
      if (!list.includes(vesselEntity.id)) list.push(vesselEntity.id);
      vesselsPerOrg.set(orgEntity.id, list);
    }
  }

  // vessel ↔ vessel sharing the same linked org (bounded clique)
  for (const [, vesselIds] of vesselsPerOrg) {
    if (vesselIds.length < SIBLING_MIN || vesselIds.length > SIBLING_MAX) continue;
    const sorted = [...vesselIds].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        pushEdge(sorted[i], sorted[j], 'sibling_vessel', 0.6, 'ofac_sdn_shared_link');
      }
    }
  }

  let edges_created = 0;
  for (const chunk of chunked(edgeInserts.slice(0, MAX_EDGE_WRITES), WRITE_CHUNK)) {
    const { error } = await supabase.from('fleet_kinship_edges').insert(chunk);
    if (error) errors.push({ stage: 'insert_edges', error: error.message });
    else edges_created += chunk.length;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    vessels_scanned: vessels.length,
    vessels_upserted,
    orgs_upserted,
    edges_created,
    skipped_existing,
    errors,
    elapsed_ms: Date.now() - startedAt,
  });
}

/** "…Vessel Registration Identification IMO 9187629; …" → "9187629" */
function extractImo(remarks: string | null): string | null {
  const m = /IMO (\d{7})/.exec(remarks ?? '');
  return m ? m[1] : null;
}

/**
 * SDN remarks are '; '-separated clauses; link clauses read
 * "Linked To: SOME ENTITY NAME." (terminal period on the last clause).
 */
function extractLinkedTo(remarks: string | null): string[] {
  if (!remarks) return [];
  const out: string[] = [];
  for (const part of remarks.split('; ')) {
    if (!part.startsWith('Linked To: ')) continue;
    const name = part.slice('Linked To: '.length).trim().replace(/\.$/, '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function normName(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim();
}

async function fetchAll<T>(page: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const batch = await page(from, from + FETCH_PAGE - 1);
    out.push(...batch);
    if (batch.length < FETCH_PAGE) break;
    from += FETCH_PAGE;
  }
  return out;
}

function* chunked<T>(arr: T[], size: number): Generator<T[], void, unknown> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
