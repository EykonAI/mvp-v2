import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getAnthropic } from '@/lib/anthropic';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { safeError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/**
 * Compute-convergences · every 15 min.
 * Clusters recent anomaly_flags by region and writes convergence_events.
 * Claude-Opus-4-7 composes the one-sentence synthesis for each cluster.
 */
export async function POST(req: NextRequest) {
  const unauth = requireCronSecret(req);
  if (unauth) return unauth;

  const supabase = createServerSupabase();
  const now = new Date();
  const since = new Date(now.getTime() - 6 * 3600_000).toISOString();

  const { data: flags, error } = await supabase
    .from('anomaly_flags')
    .select('*')
    .gte('created_at', since)
    // No processed filter: the detectors insert with the default
    // processed=false and nothing ever promotes them, so the previous
    // .eq('processed', true) starved this cron (0 events ever). De-dup is
    // handled below against convergence_events instead.
    .limit(400);

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
    const key = `${Math.floor(lat / 5) * 5}:${Math.floor(lon / 5) * 5}`;
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

    let synthesis = `Cluster of ${cluster.length} anomalies across ${Array.from(domains).join(', ')} within a 5°×5° cell around (${lat + 2.5}, ${lon + 2.5}).`;
    try {
      const anthropic = getAnthropic();
      const r = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 160,
        system: 'You are the eYKON Supervisor. Write one short English sentence describing what the cluster of anomalies means, in the voice of a senior analyst. No hedging, no lists.',
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ bbox: { lat, lon, size: 5 }, flags: cluster.slice(0, 6) }),
          },
        ],
      });
      const txt = r.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join(' ').trim();
      if (txt) synthesis = txt;
    } catch (err) {
      safeError('compute-convergences synthesis failed:', err);
    }

    writes.push({
      location: `(${(lat + 2.5).toFixed(1)}, ${(lon + 2.5).toFixed(1)})`,
      bounding_box: { lat_min: lat, lat_max: lat + 5, lon_min: lon, lon_max: lon + 5 },
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
