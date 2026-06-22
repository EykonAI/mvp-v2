import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getAnthropic } from '@/lib/anthropic';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { safeError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// Convergence detection knobs (tuned 2026-06-22 against 30d of real anomaly_flags).
// The old 6h window + 5° cell produced ~1 event/month: conflict/maritime anomalies
// are sparse and rarely shared a tight cell with the (ubiquitous) energy flags
// within 6h. 72h + 10° lifts it to ~9/month (~2/week) of genuine cross-domain
// clusters — still gated on a rare non-energy anomaly co-occurring, so no spam.
const WINDOW_MS = 72 * 3600_000;
const CELL_DEG = 10;
const CELL_HALF = CELL_DEG / 2;
const FLAG_LIMIT = 2000; // 72h of flags fits easily; headroom so an energy flood can't truncate the rare conflict/maritime flags.

/**
 * Compute-convergences · every 15 min. Clusters anomaly_flags from the last 72h
 * into 10° cells (≥2 distinct domains) and writes convergence_events.
 * Claude-Opus-4-7 composes the one-sentence synthesis for each cluster.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();

  const { data: flags, error } = await supabase
    .from('anomaly_flags')
    .select('*')
    .gte('created_at', since)
    // No processed filter: the detectors insert with the default
    // processed=false and nothing ever promotes them, so the previous
    // .eq('processed', true) starved this cron (0 events ever). De-dup is
    // handled below against convergence_events instead.
    .limit(FLAG_LIMIT);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Cells that already produced a convergence within this 6h window, so the
  // 15-min cadence doesn't re-emit the same cluster ~24× per window.
  const { data: recentConv } = await supabase
    .from('convergence_events')
    .select('bounding_box')
    .gte('created_at', since);
  const occupied = new Set<string>(
    (recentConv ?? [])
      .map(c => {
        const bb = (c as { bounding_box?: { lat_min?: number; lon_min?: number } }).bounding_box;
        return bb && Number.isFinite(bb.lat_min) && Number.isFinite(bb.lon_min)
          ? `${bb.lat_min}:${bb.lon_min}`
          : null;
      })
      .filter((k): k is string => k !== null),
  );

  // Group flags into 5°×5° spatial bins keyed on domain union size.
  const bins = new Map<string, Array<any>>();
  for (const f of flags ?? []) {
    const lat = Number(f.payload?.latitude);
    const lon = Number(f.payload?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${Math.floor(lat / CELL_DEG) * CELL_DEG}:${Math.floor(lon / CELL_DEG) * CELL_DEG}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key)!.push(f);
  }

  const writes: any[] = [];

  for (const [key, cluster] of bins) {
    const domains = new Set(cluster.map(c => c.domain));
    if (domains.size < 2) continue; // need at least two independent domains for a convergence
    if (occupied.has(key)) continue; // already emitted a convergence for this cell in-window
    occupied.add(key);
    const joint_p_value = Math.min(0.5, 0.3 / cluster.length);
    const [lat, lon] = key.split(':').map(Number);

    let synthesis = `Cluster of ${cluster.length} anomalies across ${Array.from(domains).join(', ')} within a ${CELL_DEG}°×${CELL_DEG}° cell around (${lat + CELL_HALF}, ${lon + CELL_HALF}).`;
    try {
      const anthropic = getAnthropic();
      const r = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 160,
        system: 'You are the eYKON Supervisor. Write one short English sentence describing what the cluster of anomalies means, in the voice of a senior analyst. No hedging, no lists.',
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ bbox: { lat, lon, size: CELL_DEG }, flags: cluster.slice(0, 6) }),
          },
        ],
      });
      const txt = r.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join(' ').trim();
      if (txt) synthesis = txt;
    } catch (err) {
      safeError('compute-convergences synthesis failed:', err);
    }

    writes.push({
      location: `(${(lat + CELL_HALF).toFixed(1)}, ${(lon + CELL_HALF).toFixed(1)})`,
      bounding_box: { lat_min: lat, lat_max: lat + CELL_DEG, lon_min: lon, lon_max: lon + CELL_DEG },
      joint_p_value,
      contributing_anomalies: cluster.slice(0, 6).map(f => ({ id: f.id, domain: f.domain, label: f.flag_type })),
      synthesis,
    });
  }

  if (writes.length > 0) {
    await supabase.from('convergence_events').insert(writes);
  }

  return NextResponse.json({ ok: true, clusters: writes.length });
}
