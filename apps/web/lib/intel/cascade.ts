import infra from '@/lib/fixtures/infra_edges.json';

export interface CascadeInput {
  seed_nodes: string[];
  capacity_loss_pct: number;
  outage_duration_hours: number;
}

export interface CascadeNode {
  id: string;
  tier: 'source' | 'transit' | 'processing' | 'delivery';
  label: string;
  throughput_kbd: number;
  starved_kbd: number;
  status: 'ok' | 'warn' | 'crit';
}

export interface CascadeEdge {
  from: string;
  to: string;
  flow_kbd: number;
  active: boolean;
}

export interface CascadeOutput {
  input: CascadeInput;
  nodes: CascadeNode[];
  edges: CascadeEdge[];
  timeline: Array<{ label: string; affected_nodes: string[] }>;
  substitution_cost: Array<{ from: string; to: string; cost_usd_bbl: number }>;
  grid_stress: number;
  computed_at: string;
}

/** Deterministic cascade model (v1) — first-order propagation only. */
export function propagateCascade(input: CascadeInput): CascadeOutput {
  const lostFrac = Math.max(0, Math.min(1, input.capacity_loss_pct / 100));
  const seedSet = new Set(input.seed_nodes);

  // Downstream-starved propagation: cut flow on edges leaving starved nodes.
  const nodeLookup = new Map(infra.nodes.map(n => [n.id, n]));
  const starvedFlow = new Map<string, number>();

  const edges = infra.edges.map((e: { from: string; to: string; flow_kbd: number }) => {
    const sourceStarved = seedSet.has(e.from);
    const reducedFlow = sourceStarved ? e.flow_kbd * (1 - lostFrac) : e.flow_kbd;
    if (sourceStarved) {
      starvedFlow.set(e.to, (starvedFlow.get(e.to) ?? 0) + e.flow_kbd * lostFrac);
    }
    return { from: e.from, to: e.to, flow_kbd: Math.round(reducedFlow), active: reducedFlow > 0 };
  });

  const nodes: CascadeNode[] = infra.nodes.map((n: any) => {
    const starved = starvedFlow.get(n.id) ?? (seedSet.has(n.id) ? n.throughput_kbd * lostFrac : 0);
    const status: CascadeNode['status'] =
      starved === 0 ? (n.status as CascadeNode['status']) : starved >= n.throughput_kbd * 0.6 ? 'crit' : 'warn';
    return {
      id: n.id,
      tier: n.tier as CascadeNode['tier'],
      label: n.label,
      throughput_kbd: n.throughput_kbd,
      starved_kbd: Math.round(starved),
      status,
    };
  });

  const substitution_cost = Array.from(starvedFlow.entries())
    .slice(0, 6)
    .map(([nodeId, amount]) => ({
      from: nodeLookup.get(nodeId)?.label ?? nodeId,
      to: 'Next-cheapest source',
      cost_usd_bbl: round2(4 + (amount / 500) * 3),
    }));

  const timeline = [
    { label: 'T+24h', affected_nodes: Array.from(starvedFlow.keys()).slice(0, 3) },
    { label: 'T+48h', affected_nodes: Array.from(starvedFlow.keys()).slice(0, 5) },
    { label: 'T+72h', affected_nodes: Array.from(starvedFlow.keys()) },
    { label: 'T+7d',  affected_nodes: Array.from(starvedFlow.keys()) },
  ];

  const grid_stress = round2(Math.min(1, lostFrac * 0.9));

  return {
    input,
    nodes,
    edges,
    timeline,
    substitution_cost,
    grid_stress,
    computed_at: new Date().toISOString(),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
