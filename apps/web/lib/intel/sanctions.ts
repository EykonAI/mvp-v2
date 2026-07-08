import type { SupabaseClient } from '@supabase/supabase-js';
import reflag from '@/lib/fixtures/reflag_destinations.json';

export interface SanctionsInput {
  sanctioning_bodies: Array<'OFAC' | 'EU' | 'UK_OFSI' | 'UN' | 'G7_PRICE_CAP'>;
  preset:
    | 'sdn_new_listing'
    | 'secondary_expansion'
    | 'price_cap_tightening'
    | 'maritime_insurance_ban'
    | 'port_of_call_restriction';
  target_entities: string[];
  depth: 1 | 2 | 3;
}

export interface WargameNode {
  id: string;
  label: string;
  ring: 0 | 1 | 2 | 3;
  severity: 'seed' | 'high' | 'medium' | 'low';
  /** true = node comes from the OFAC-derived entity graph; false/absent = synthetic expansion */
  real?: boolean;
  /** OFAC sanction programs carried on real nodes (e.g. ['IRAN', 'RUSSIA-EO14024']) */
  programs?: string[];
}

export interface WargameEdge {
  from: string;
  to: string;
  projected_reflag?: boolean;
}

export interface SanctionsOutput {
  input: SanctionsInput;
  nodes: WargameNode[];
  edges: WargameEdge[];
  fleet_scope: { affected: number; total: number; window_days: number };
  top_affected: Array<{ label: string; weighted_hop_distance: number; severity: string }>;
  reflag_destinations: Array<{ flag: string; share: number }>;
  graph_source: 'live' | 'synthetic' | 'mixed';
  computed_at: string;
}

/** Max first-hop neighbours per target (IRISL alone has ~121 linked vessels). */
const MAX_HOP1 = 12;
/** Max second-hop neighbours per target. */
const MAX_HOP2 = 20;

interface LiveNeighbourhood {
  seed: WargameNode;
  nodes: WargameNode[];
  edges: WargameEdge[];
  hop1: WargameNode[];
}

/**
 * Deterministic sanctions-wargame model (v2).
 *
 * Network topology: when a Supabase client is provided, each target is
 * resolved against the `entities` table (ILIKE on canonical_name; the
 * candidate with the most `fleet_kinship_edges` wins) and its real
 * OFAC-derived neighbourhood is walked up to 2 hops. Targets that do
 * not resolve — or resolve to an entity with no edges — fall back to
 * the original synthetic expansion, and `graph_source` reports
 * 'live' / 'synthetic' / 'mixed' accordingly.
 *
 * Model dynamics (fleet-scope fractions, hop weights, reflag shares)
 * remain deterministic illustrative parameters in both paths.
 */
export async function runWargame(
  input: SanctionsInput,
  supabase?: SupabaseClient,
): Promise<SanctionsOutput> {
  const nodes: WargameNode[] = [];
  const edges: WargameEdge[] = [];
  const seen = new Set<string>();
  let liveTargets = 0;

  for (let i = 0; i < input.target_entities.length; i++) {
    const e = input.target_entities[i];

    let live: LiveNeighbourhood | null = null;
    if (supabase) {
      try {
        live = await realNeighbourhood(supabase, e, input.depth);
      } catch {
        live = null; // DB unavailable → synthetic fallback, never a hard failure
      }
    }

    let hop1: WargameNode[];
    let seedId: string;

    if (live) {
      liveTargets++;
      seedId = live.seed.id;
      if (!seen.has(live.seed.id)) {
        nodes.push(live.seed);
        seen.add(live.seed.id);
      }
      for (const n of live.nodes) {
        if (!seen.has(n.id)) {
          nodes.push(n);
          seen.add(n.id);
        }
      }
      edges.push(...live.edges);
      hop1 = live.hop1;
    } else {
      seedId = `seed-${slugify(e)}`;
      nodes.push({ id: seedId, label: e, ring: 0, severity: 'seed', real: false });
      seen.add(seedId);

      // First-hop affected: operator / flag / vessel / port adjacent
      hop1 = adjacenciesFor(e, i);
      for (const h of hop1) {
        if (!seen.has(h.id)) {
          nodes.push({ ...h, ring: 1 });
          seen.add(h.id);
        }
        edges.push({ from: seedId, to: h.id });
      }

      if (input.depth >= 2) {
        // Second-hop: broader commercial network
        const hop2 = secondaryAdjacencies(e, i);
        for (const h of hop2) {
          if (!seen.has(h.id)) {
            nodes.push({ ...h, ring: 2 });
            seen.add(h.id);
          }
          // link to a random first-hop as approx
          const pick = hop1[h.id.charCodeAt(0) % hop1.length];
          edges.push({ from: pick.id, to: h.id });
        }
      }
    }

    if (input.depth >= 3) {
      // Third-hop: projected reflags (always a modelled projection)
      const anchors = hop1.length > 0 ? hop1 : nodes.filter(n => n.id === seedId);
      const hop3 = reflag.destinations.slice(0, 5).map(d => ({
        id: `reflag-${d.flag_code.toLowerCase()}-${i}`,
        label: `Reflag · ${d.label}`,
        ring: 3 as const,
        severity: 'low' as const,
        real: false,
      }));
      for (const h of hop3) {
        if (!seen.has(h.id)) {
          nodes.push(h);
          seen.add(h.id);
        }
        const pick = anchors[h.id.charCodeAt(0) % anchors.length];
        edges.push({ from: pick.id, to: h.id, projected_reflag: true });
      }
    }
  }

  const total = 480 + input.target_entities.length * 120;
  const affectedFraction = scopeFraction(input);
  const affected = Math.round(total * affectedFraction);

  const top_affected = nodes
    .filter(n => n.ring > 0)
    .slice(0, 8)
    .map((n, i) => ({
      label: n.label,
      weighted_hop_distance: round2(0.8 + n.ring * 0.4 + i * 0.03),
      severity: n.severity,
    }));

  const reflag_destinations = reflag.destinations.map(d => ({
    flag: d.label,
    share: d.share,
  }));

  const graph_source: SanctionsOutput['graph_source'] =
    liveTargets === 0 ? 'synthetic' : liveTargets === input.target_entities.length ? 'live' : 'mixed';

  return {
    input,
    nodes,
    edges,
    fleet_scope: { affected, total, window_days: 90 },
    top_affected,
    reflag_destinations,
    graph_source,
    computed_at: new Date().toISOString(),
  };
}

interface EntityRecord {
  id: string;
  canonical_name: string;
  entity_type: string;
  metadata: Record<string, unknown> | null;
}

interface EdgeRecord {
  source_entity_id: string;
  target_entity_id: string;
  weight: number | null;
}

/**
 * Resolve a target name against `entities` and walk `fleet_kinship_edges`
 * up to 2 hops. Returns null when the name does not resolve to an entity
 * with at least one edge (caller falls back to synthetic expansion).
 */
async function realNeighbourhood(
  supabase: SupabaseClient,
  targetName: string,
  depth: 1 | 2 | 3,
): Promise<LiveNeighbourhood | null> {
  const cleaned = targetName.trim().replaceAll(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const { data: candidates, error } = await supabase
    .from('entities')
    .select('id, canonical_name, entity_type, metadata')
    .ilike('canonical_name', `%${cleaned}%`)
    .limit(5);
  if (error || !candidates || candidates.length === 0) return null;

  // Prefer the candidate with the most kinship edges
  let best: EntityRecord | null = null;
  let bestEdges: EdgeRecord[] = [];
  for (const c of candidates as EntityRecord[]) {
    const around = await edgesTouching(supabase, [c.id], 200);
    if (around.length > bestEdges.length) {
      best = c;
      bestEdges = around;
    }
  }
  if (!best || bestEdges.length === 0) return null;

  const seed: WargameNode = {
    id: best.id,
    label: best.canonical_name,
    ring: 0,
    severity: 'seed',
    real: true,
    programs: programsOf(best),
  };

  // ── hop 1 ──
  const hop1Ids: string[] = [];
  const liveEdges: WargameEdge[] = [];
  const sorted = [...bestEdges].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  for (const ed of sorted) {
    const other = ed.source_entity_id === best.id ? ed.target_entity_id : ed.source_entity_id;
    if (other === best.id || hop1Ids.includes(other)) continue;
    if (hop1Ids.length >= MAX_HOP1) break;
    hop1Ids.push(other);
    liveEdges.push({ from: best.id, to: other });
  }

  // ── hop 2 ──
  const hop2Ids: string[] = [];
  if (depth >= 2 && hop1Ids.length > 0) {
    const around = await edgesTouching(supabase, hop1Ids, 400);
    for (const ed of around) {
      const inHop1Source = hop1Ids.includes(ed.source_entity_id);
      const anchor = inHop1Source ? ed.source_entity_id : ed.target_entity_id;
      const other = inHop1Source ? ed.target_entity_id : ed.source_entity_id;
      if (other === best.id || hop1Ids.includes(other)) continue;
      if (!hop2Ids.includes(other)) {
        if (hop2Ids.length >= MAX_HOP2) continue;
        hop2Ids.push(other);
      }
      liveEdges.push({ from: anchor, to: other });
    }
  }

  // ── resolve node details ──
  const allIds = [...hop1Ids, ...hop2Ids];
  const details = new Map<string, EntityRecord>();
  if (allIds.length > 0) {
    const { data } = await supabase
      .from('entities')
      .select('id, canonical_name, entity_type, metadata')
      .in('id', allIds);
    for (const row of (data ?? []) as EntityRecord[]) details.set(row.id, row);
  }

  const toNode = (id: string, ring: 1 | 2): WargameNode => {
    const d = details.get(id);
    return {
      id,
      label: d?.canonical_name ?? 'Unknown entity',
      ring,
      severity: ring === 1 ? 'high' : 'medium',
      real: true,
      programs: d ? programsOf(d) : undefined,
    };
  };

  const hop1Nodes = hop1Ids.map(id => toNode(id, 1));
  const hop2Nodes = hop2Ids.map(id => toNode(id, 2));
  const known = new Set([best.id, ...allIds]);

  return {
    seed,
    nodes: [...hop1Nodes, ...hop2Nodes],
    edges: liveEdges.filter(e => known.has(e.from) && known.has(e.to)),
    hop1: hop1Nodes,
  };
}

async function edgesTouching(
  supabase: SupabaseClient,
  ids: string[],
  limit: number,
): Promise<EdgeRecord[]> {
  if (ids.length === 0) return [];
  const list = ids.join(',');
  const { data, error } = await supabase
    .from('fleet_kinship_edges')
    .select('source_entity_id, target_entity_id, weight')
    .or(`source_entity_id.in.(${list}),target_entity_id.in.(${list})`)
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as EdgeRecord[];
}

function programsOf(e: EntityRecord): string[] | undefined {
  const p = (e.metadata as Record<string, unknown> | null)?.programs;
  return Array.isArray(p) ? (p as string[]) : undefined;
}

function adjacenciesFor(name: string, i: number): WargameNode[] {
  return [
    { id: `${slugify(name)}-a`, label: `${name} · Operator-A`, ring: 1, severity: 'high', real: false },
    { id: `${slugify(name)}-b`, label: `${name} · Flag-${i % 2 === 0 ? 'COK' : 'GAB'}`, ring: 1, severity: 'medium', real: false },
    { id: `${slugify(name)}-c`, label: `${name} · Fleet cluster`, ring: 1, severity: 'high', real: false },
  ];
}

function secondaryAdjacencies(name: string, i: number): WargameNode[] {
  return [
    { id: `${slugify(name)}-x`, label: `${name} · BO chain`, ring: 2, severity: 'medium', real: false },
    { id: `${slugify(name)}-y`, label: `${name} · Insurer ${i + 1}`, ring: 2, severity: 'medium', real: false },
    { id: `${slugify(name)}-z`, label: `${name} · Port cluster ${i + 1}`, ring: 2, severity: 'low', real: false },
  ];
}

function scopeFraction(input: SanctionsInput): number {
  const bodyMult = input.sanctioning_bodies.length >= 3 ? 0.45 : input.sanctioning_bodies.length === 2 ? 0.32 : 0.21;
  const presetMult =
    input.preset === 'secondary_expansion' ? 1.2 :
    input.preset === 'maritime_insurance_ban' ? 1.15 :
    input.preset === 'price_cap_tightening' ? 1.05 : 1.0;
  const depthMult = input.depth === 3 ? 1.2 : input.depth === 2 ? 1.0 : 0.8;
  return Math.min(0.9, bodyMult * presetMult * depthMult);
}

function slugify(s: string): string {
  return s.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
