import { createServerSupabase } from '@/lib/supabase-server';

/**
 * Commodity shipments — unified read model (PR 2, D4).
 *
 * DESIGNED FOR THE PAID AIS TIER, running degraded on free. One row
 * shape for every commodity family; the free tier simply cannot fill
 * some columns (cargo_class, laden, eta) and the payload carries the
 * coverage disclosure instead of pretending. When a paid provider
 * lands, vessel_positions/port_calls densify and the same table fills
 * — no schema change, no UI rework.
 *
 * Sources per family:
 *  • mineral slugs — mineral_shipments (migration 080, live today),
 *    mapped into the unified shape. Zero new backend.
 *  • oil (brent/wti) — commodity_shipments (migration 104), derived
 *    daily by the shipments cron from tanker-class vessels with a
 *    port call at an oil port (a port within an EXPLICIT 5 km of a
 *    registry refinery — a checkable mapping, never a name join).
 *  • wheat / ttf — honestly unsupportable on free AIS (vessel_type is
 *    NULL on >99% of rows; no grain-port classification; LNG class
 *    needs static data). supported:false with the reason, awaiting
 *    the paid tier.
 *
 * Every row is AIS-INFERRED — AIS never sees cargo — and says so.
 */

const FAMILY_BY_SLUG: Record<string, 'mineral' | 'oil' | 'unsupported'> = {
  cobalt: 'mineral',
  lithium: 'mineral',
  ree: 'mineral',
  copper: 'mineral',
  graphite: 'mineral',
  nickel: 'mineral',
  brent: 'oil',
  wti: 'oil',
  wheat: 'unsupported',
  ttf: 'unsupported',
};

const UNSUPPORTED_REASON: Record<string, string> = {
  wheat:
    'Awaiting paid AIS — grain attribution needs bulk-carrier class (static data) and grain-terminal classification, neither available on the free tier.',
  ttf:
    'Awaiting paid AIS — LNG-carrier identification needs static vessel data, absent on the free tier.',
};

export interface ShipmentRow {
  mmsi: string;
  imo: string | null;
  vessel_name: string | null;
  flag: string | null;
  cargo_class: string | null; // paid tier; null renders as "—"
  laden: 'laden' | 'ballast' | null;
  laden_method: string | null;
  origin_port: string | null;
  origin_country: string | null;
  destination: string | null;
  destination_kind: 'declared' | 'inferred' | 'unknown';
  eta: string | null;
  eta_kind: 'declared' | 'estimated' | null;
  confidence: 'high' | 'medium' | 'low';
  method: string;
  dark_gap_hours: number | null;
  last_seen: string;
  status: string;
}

export interface ShipmentsPayload {
  commodity: string;
  supported: boolean;
  reason?: string;
  coverage_scope: 'global' | 'chokepoint';
  feed_stale_days: number | null; // null = feed live
  inference_note: string;
  rows: ShipmentRow[];
  errors: string[];
}

export async function buildShipmentsPayload(commodity: string): Promise<ShipmentsPayload | null> {
  const family = FAMILY_BY_SLUG[commodity];
  if (!family) return null;

  const supabase = createServerSupabase();
  const errors: string[] = [];

  // Feed staleness — the disclosure every row inherits. The AIS feed
  // going dark freezes port_calls and destinations; the panel must
  // carry that rather than present a frozen table as current.
  let feedStaleDays: number | null = null;
  {
    const { data, error } = await supabase
      .from('vessel_positions')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) {
      errors.push(`vessel_positions liveness: ${error.message}`);
      feedStaleDays = -1; // unknown reads as stale, never as live
    } else {
      const newest = data?.[0]?.updated_at ? new Date(data[0].updated_at as string) : null;
      const ageDays = newest ? (Date.now() - newest.getTime()) / (24 * 3600_000) : null;
      feedStaleDays = ageDays !== null && ageDays > 1 ? Math.floor(ageDays) : ageDays === null ? -1 : null;
    }
  }

  if (family === 'unsupported') {
    return {
      commodity,
      supported: false,
      reason: UNSUPPORTED_REASON[commodity],
      coverage_scope: 'chokepoint',
      feed_stale_days: feedStaleDays,
      inference_note: 'AIS never sees cargo; commodity attribution is inference and is stated per row.',
      rows: [],
      errors,
    };
  }

  let rows: ShipmentRow[] = [];

  if (family === 'oil') {
    const { data, error } = await supabase
      .from('commodity_shipments')
      .select(
        'mmsi, imo, vessel_name, flag, cargo_class, laden, laden_method, origin_port, origin_country, destination, destination_kind, eta, eta_kind, confidence, method, dark_gap_hours, last_seen, status',
      )
      .eq('commodity', 'oil')
      .eq('status', 'underway')
      .order('last_seen', { ascending: false })
      .limit(12);
    if (error) {
      errors.push(`commodity_shipments: ${error.message}`);
    } else {
      rows = (data ?? []) as ShipmentRow[];
    }
  } else {
    // Minerals — reuse the live table, mapped into the unified shape.
    const { data, error } = await supabase
      .from('mineral_shipments')
      .select('mmsi, vessel_name, flag, origin_port, origin_country, dest_hint, inferred_from, last_seen, status')
      .eq('mineral', commodity)
      .eq('status', 'underway')
      .order('last_seen', { ascending: false })
      .limit(12);
    if (error) {
      errors.push(`mineral_shipments: ${error.message}`);
    } else {
      rows = ((data ?? []) as Array<{
        mmsi: string; vessel_name: string | null; flag: string | null;
        origin_port: string | null; origin_country: string | null; dest_hint: string | null;
        inferred_from: string; last_seen: string; status: string;
      }>).map(r => ({
        mmsi: r.mmsi,
        imo: null,
        vessel_name: r.vessel_name,
        flag: r.flag,
        cargo_class: null,
        laden: null,
        laden_method: null,
        origin_port: r.origin_port,
        origin_country: r.origin_country,
        destination: r.dest_hint,
        destination_kind: r.dest_hint ? ('declared' as const) : ('unknown' as const),
        eta: null,
        eta_kind: null,
        // destination+port_call is the strengthened inference (mig 080).
        confidence: r.inferred_from.includes('port_call') ? ('high' as const) : ('medium' as const),
        method: r.inferred_from,
        dark_gap_hours: null,
        last_seen: r.last_seen,
        status: r.status,
      }));
    }
  }

  return {
    commodity,
    supported: true,
    coverage_scope: 'chokepoint', // free tier; rows carry their own scope once paid AIS lands
    feed_stale_days: feedStaleDays,
    inference_note:
      'AIS-inferred: vessel class + port-call at a commodity-linked terminal. AIS never sees cargo; confidence and method are stated per row.',
    rows,
    errors,
  };
}
