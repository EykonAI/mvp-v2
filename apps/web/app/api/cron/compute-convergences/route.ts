import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getAnthropic } from '@/lib/anthropic';
import { requireCronSecret } from '@/lib/intel/cronAuth';

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
    .eq('processed', true)
    .limit(400);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

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
      console.error('compute-convergences synthesis failed:', err instanceof Error ? err.message : err);
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
