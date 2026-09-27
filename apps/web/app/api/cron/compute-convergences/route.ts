import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getAnthropic } from '@/lib/anthropic';
import { requireCronSecret } from '@/lib/intel/cronAuth';
import { safeError } from '@/lib/log';
import { SYNTHESIS_SYSTEM_PROMPT, synthesisOverclaims } from '@/lib/intel/convergenceSynthesis';
import { clusterFlags } from '@/lib/intel/convergenceCluster';

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

  const writes: any[] = [];

  // The clustering rules live in lib/intel/convergenceCluster.ts (tested by
  // scripts/intel/test-convergence-cluster.mjs); the route adds the prose.
  for (const c of clusterFlags(flags ?? [], occupied, CELL_DEG)) {
    const { lat, lon, flags: cluster, domains, classes, joint_p_value, corroboration_level } = c;

    let synthesis = `Cluster of ${cluster.length} anomalies across ${domains.join(', ')} within a ${CELL_DEG}°×${CELL_DEG}° cell around (${lat + CELL_HALF}, ${lon + CELL_HALF}).`;
    try {
      const anthropic = getAnthropic();
      const r = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 160,
        system: SYNTHESIS_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            // corroboration_level is deliberately NOT sent: its value
            // "sensor-confirmed" was read by the model as licence to write
            // "corroborated" (rev H PR-10). The classes carry the same facts.
            content: JSON.stringify({
              bbox: { lat, lon, size: CELL_DEG },
              source_classes: classes,
              flags: cluster.slice(0, 6),
            }),
          },
        ],
      });
      const txt = r.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join(' ').trim();
      // The fence: an overclaiming sentence is dropped for the deterministic
      // one above, never stored and never served on /c/[id].
      if (txt && !synthesisOverclaims(txt)) synthesis = txt;
      else if (txt) safeError('compute-convergences synthesis rejected (overclaim):', txt.slice(0, 200));
    } catch (err) {
      safeError('compute-convergences synthesis failed:', err);
    }

    writes.push({
      location: `(${(lat + CELL_HALF).toFixed(1)}, ${(lon + CELL_HALF).toFixed(1)})`,
      bounding_box: { lat_min: lat, lat_max: lat + CELL_DEG, lon_min: lon, lon_max: lon + CELL_DEG },
      joint_p_value,
      corroboration_level,
      source_classes: classes,
      contributing_anomalies: cluster.slice(0, 6).map(f => ({ id: f.id, domain: f.domain, label: f.flag_type })),
      synthesis,
    });
  }

  if (writes.length > 0) {
    await supabase.from('convergence_events').insert(writes);
  }

  // Corroboration breakdown so a Railway log shows at a glance whether the
  // run produced genuinely sensor-confirmed convergences or just correlated
  // media clusters.
  const byCorroboration = writes.reduce<Record<string, number>>((acc, w) => {
    acc[w.corroboration_level] = (acc[w.corroboration_level] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ ok: true, clusters: writes.length, by_corroboration: byCorroboration });
}
