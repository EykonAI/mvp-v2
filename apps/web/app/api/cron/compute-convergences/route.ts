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

// Independence, not domain count, is what makes a convergence mean anything.
// Conflict (ACLED) and Energy (GDELT) are BOTH media-derived: one news wave
// lights up both, so "two domains" can be one source of evidence. Thermal
// (FIRMS radiometry) and Maritime (AIS) are PHYSICALLY independent witnesses —
// a satellite hot pixel and a vessel track don't move with a headline. The
// score below counts distinct SOURCE CLASSES, so redundant media flags no
// longer inflate significance, and a sensor agreeing with the news is what
// actually earns a low p. A domain not in this map counts as its own class.
const SOURCE_CLASS: Record<string, string> = {
  Conflict: 'media',
  Energy: 'media',
  Maritime: 'sensor-ais',
  Thermal: 'sensor-firms',
};
function sourceClass(domain: string): string {
  return SOURCE_CLASS[domain] ?? `other:${domain}`;
}

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
    const domains = new Set<string>(cluster.map(c => c.domain));
    if (domains.size < 2) continue; // need at least two distinct domains to even consider a convergence
    if (occupied.has(key)) continue; // already emitted a convergence for this cell in-window
    occupied.add(key);

    // Independence-weighted score. Distinct SOURCE CLASSES — not the raw
    // flag count — drive the p-value, so ten correlated media flags no
    // longer read as stronger than two genuinely independent signals.
    //   K = 1 → 0.30  (single-source: same evidence twice; barely a convergence)
    //   K = 2 → 0.15
    //   K = 3 → 0.10
    const classSet = new Set<string>(Array.from(domains).map(sourceClass));
    const classes = Array.from(classSet).sort();
    const K = classSet.size;
    const joint_p_value = Math.min(0.5, 0.3 / Math.max(K, 1));
    const hasSensor = classes.some(c => c.startsWith('sensor'));
    const corroboration_level =
      K >= 2 && hasSensor ? 'sensor-confirmed' : K >= 2 ? 'multi-source' : 'single-source';
    const [lat, lon] = key.split(':').map(Number);

    let synthesis = `Cluster of ${cluster.length} anomalies across ${Array.from(domains).join(', ')} within a ${CELL_DEG}°×${CELL_DEG}° cell around (${lat + CELL_HALF}, ${lon + CELL_HALF}).`;
    try {
      const anthropic = getAnthropic();
      const r = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 160,
        system:
          'You are the eYKON Supervisor. Write one short English sentence describing what the cluster of anomalies means, in the voice of a senior analyst. No hedging, no lists. ' +
          'corroboration_level tells you how independent the evidence is: "single-source" means every signal is media-derived (ACLED/GDELT) and could all stem from one news wave — say the activity is REPORTED, do not imply physical confirmation; ' +
          '"sensor-confirmed" means a physical sensor (FIRMS thermal or AIS maritime) independently agrees — you may state the signals corroborate.',
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              bbox: { lat, lon, size: CELL_DEG },
              corroboration_level,
              source_classes: classes,
              flags: cluster.slice(0, 6),
            }),
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
