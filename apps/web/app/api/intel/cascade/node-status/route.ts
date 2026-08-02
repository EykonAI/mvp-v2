import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import infra from '@/lib/fixtures/infra_edges.json';

export const dynamic = 'force-dynamic';

/**
 * Observed sensor state for each cascade node.
 *
 * The Cascade workspace is a deterministic scenario model over a fixture
 * topology, and stays badged as one. This route does not change that —
 * it replaces the fixture's HARDCODED node status (ok / warn / crit,
 * nine of fifteen saying "ok") with what the satellites actually saw
 * near each hub.
 *
 * ─── Proximity, never name matching ───────────────────────────────
 * A cascade node is an abstract hub; the sensors watch specific
 * facilities. Joining them by name measured badly and dishonestly:
 * "Rotterdam" matches 17 registry facilities, mostly unrelated power
 * plants, so a stray flare would have been attributed to the delivery
 * hub. The RPC (migration 097) uses an explicit radius instead, which
 * makes the claim checkable: "within 25 km of this hub".
 *
 * ─── The states, and why "not observed" is the important one ──────
 *   not_observed  nothing watched AND no thermal coverage near the hub.
 *                 The fixture called several of these "ok". They are
 *                 opposite claims: one asserts health, the other admits
 *                 ignorance. Primorsk is the clean example — 0
 *                 facilities, 0 detections.
 *   observed      we are looking and nothing has departed from baseline.
 *   significant   a thermal or night-lights event fired — a departure
 *                 from a facility's OWN baseline, not merely activity.
 *
 * detections is returned as CONTEXT and never drives severity. Basra
 * logs ~185 hot pixels a week and Port Arthur ~122; that is what a
 * working oil field and refinery complex look like from orbit. Treating
 * routine flaring as an alarm is the fastest way to teach a reader to
 * ignore the product.
 */

const RADIUS_KM = 25;
const WINDOW_DAYS = 7;

type NodeStatus = 'not_observed' | 'observed' | 'significant';

interface RpcRow {
  node_id: string;
  facilities_nearby: number;
  facilities_watched: number;
  detections: number;
  thermal_events: number;
  nightlights_events: number;
  latest_event_type: string | null;
  latest_event_at: string | null;
}

export async function GET() {
  const nodes = (infra as { nodes: Array<{ id: string; lat?: number; lon?: number }> }).nodes;
  const located = nodes
    .filter(n => typeof n.lat === 'number' && typeof n.lon === 'number')
    .map(n => ({ node_id: n.id, lat: n.lat, lon: n.lon }));

  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase.rpc('cascade_node_sensor_status', {
      p_nodes: located,
      p_radius_km: RADIUS_KM,
      p_days: WINDOW_DAYS,
    });

    if (error) {
      // Degrade honestly: the workspace keeps its fixture status and is
      // told the observed layer is unavailable, rather than being handed
      // a silent "everything is fine".
      return NextResponse.json({
        degraded: true,
        reason: error.message,
        radius_km: RADIUS_KM,
        window_days: WINDOW_DAYS,
        nodes: {},
      });
    }

    const rows = (data ?? []) as RpcRow[];
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      const events = Number(r.thermal_events ?? 0) + Number(r.nightlights_events ?? 0);
      const watched = Number(r.facilities_watched ?? 0);
      const detections = Number(r.detections ?? 0);

      const status: NodeStatus =
        events > 0 ? 'significant'
        : watched > 0 || detections > 0 ? 'observed'
        : 'not_observed';

      out[r.node_id] = {
        status,
        facilities_nearby: Number(r.facilities_nearby ?? 0),
        facilities_watched: watched,
        // Raw hot pixels. Mostly routine industrial flaring — shown as
        // context so a reader can see the hub is alive, never as severity.
        detections_7d: detections,
        thermal_events: Number(r.thermal_events ?? 0),
        nightlights_events: Number(r.nightlights_events ?? 0),
        latest_event_type: r.latest_event_type,
        latest_event_at: r.latest_event_at,
      };
    }

    return NextResponse.json({
      degraded: false,
      radius_km: RADIUS_KM,
      window_days: WINDOW_DAYS,
      nodes: out,
      caveat:
        'Observed state within ' + RADIUS_KM + ' km of each hub centroid over ' + WINDOW_DAYS +
        ' days. Detections are satellite hot pixels — mostly routine industrial flaring, shown as ' +
        'context and never as severity; only significance events represent a departure from a ' +
        "facility's own baseline. \"not_observed\" means no sensor coverage near that hub — it is " +
        'not a statement that the hub is healthy. Night-lights observations run ~1-2 weeks behind. ' +
        'The cascade propagation itself remains an illustrative model.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ degraded: true, reason: message, nodes: {} });
  }
}
