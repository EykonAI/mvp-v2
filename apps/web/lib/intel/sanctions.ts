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
  computed_at: string;
}

/**
 * Deterministic sanctions-wargame model (v1).
 * Walks a synthetic kinship graph seeded from the input entities.
 * When the `entities` + `fleet_kinship_edges` tables are populated
 * by the behavioural agent this function will be swapped to walk the
 * real graph; the return shape stays stable.
 */
export function runWargame(input: SanctionsInput): SanctionsOutput {
  const nodes: WargameNode[] = [];
  const edges: WargameEdge[] = [];
  const seen = new Set<string>();

  input.target_entities.forEach((e, i) => {
    const id = `seed-${slugify(e)}`;
    nodes.push({ id, label: e, ring: 0, severity: 'seed' });
    seen.add(id);

    // First-hop affected: operator / flag / vessel / port adjacent
    const hop1 = adjacenciesFor(e, i);
    for (const h of hop1) {
      if (!seen.has(h.id)) {
        nodes.push({ ...h, ring: 1 });
        seen.add(h.id);
      }
      edges.push({ from: id, to: h.id });
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

    if (input.depth >= 3) {
      // Third-hop: projected reflags
      const hop3 = reflag.destinations.slice(0, 5).map(d => ({
        id: `reflag-${d.flag_code.toLowerCase()}-${i}`,
        label: `Reflag · ${d.label}`,
        ring: 3 as const,
        severity: 'low' as const,
      }));
      for (const h of hop3) {
        if (!seen.has(h.id)) {
          nodes.push(h);
          seen.add(h.id);
        }
        const pick = hop1[h.id.charCodeAt(0) % hop1.length];
        edges.push({ from: pick.id, to: h.id, projected_reflag: true });
      }
    }
  });

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

  return {
    input,
    nodes,
    edges,
    fleet_scope: { affected, total, window_days: 90 },
    top_affected,
    reflag_destinations,
    computed_at: new Date().toISOString(),
  };
}

function adjacenciesFor(name: string, i: number): WargameNode[] {
  return [
    { id: `${slugify(name)}-a`, label: `${name} · Operator-A`, ring: 1, severity: 'high' },
    { id: `${slugify(name)}-b`, label: `${name} · Flag-${i % 2 === 0 ? 'COK' : 'GAB'}`, ring: 1, severity: 'medium' },
    { id: `${slugify(name)}-c`, label: `${name} · Fleet cluster`, ring: 1, severity: 'high' },
  ];
}

function secondaryAdjacencies(name: string, i: number): WargameNode[] {
  return [
    { id: `${slugify(name)}-x`, label: `${name} · BO chain`, ring: 2, severity: 'medium' },
    { id: `${slugify(name)}-y`, label: `${name} · Insurer ${i + 1}`, ring: 2, severity: 'medium' },
    { id: `${slugify(name)}-z`, label: `${name} · Port cluster ${i + 1}`, ring: 2, severity: 'low' },
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
