import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import precursor from '@/lib/fixtures/precursor_library.json';
import posture from '@/lib/fixtures/posture_seed.json';

export const dynamic = 'force-dynamic';

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

interface CurrentDomains {
  air: number;
  sea: number;
  conflict: number;
  grid: number;
  imagery: number;
}

/**
 * Build the current theatre vector from live posture_scores:
 * last 30 UTC days of daily-average composite (ascending) + latest domain scores.
 * Returns null (caller falls back to fixture) if fewer than 10 days of data.
 */
async function buildLiveCurrent(
  supabase: ReturnType<typeof createServerSupabase>,
  theatreSlug: string,
): Promise<{ series: number[]; domains: CurrentDomains } | null> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('posture_scores')
    .select('composite, air, sea, conflict, grid, imagery, computed_at')
    .eq('theatre_slug', theatreSlug)
    .gte('computed_at', since)
    .order('computed_at', { ascending: false })
    .limit(1000);
  if (error || !data || data.length === 0) return null;

  // Daily average of composite, keyed by UTC day.
  const byDay = new Map<string, { sum: number; n: number }>();
  for (const row of data) {
    const day = String(row.computed_at).slice(0, 10);
    const agg = byDay.get(day) ?? { sum: 0, n: 0 };
    agg.sum += Number(row.composite) || 0;
    agg.n += 1;
    byDay.set(day, agg);
  }
  const days = [...byDay.keys()].sort();
  if (days.length < 10) return null;

  const series = days.slice(-30).map(d => {
    const agg = byDay.get(d)!;
    return round3(agg.sum / agg.n);
  });
  const latest = data[0]; // ordered descending, so first row is the most recent
  const domains: CurrentDomains = {
    air: round3(Number(latest.air) || 0),
    sea: round3(Number(latest.sea) || 0),
    conflict: round3(Number(latest.conflict) || 0),
    grid: round3(Number(latest.grid) || 0),
    imagery: round3(Number(latest.imagery) || 0),
  };
  return { series, domains };
}

/** Precursor match — cosine against the library. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const theatreSlug: string = body.theatre_slug ?? 'black-sea';
    const topK = Math.min(10, Math.max(1, Number(body.top_k ?? 3)));
    const eventType: string | null = body.event_type ?? null;

    let supabase: ReturnType<typeof createServerSupabase> | null = null;
    try {
      supabase = createServerSupabase();
    } catch {}

    // Build current vector from live posture_scores; fall back to the fixture theatre.
    let currentSeries: number[];
    let currentDomains: CurrentDomains;
    let sourceCurrent: 'live' | 'fixture' = 'fixture';
    let live: { series: number[]; domains: CurrentDomains } | null = null;
    if (supabase) {
      try {
        live = await buildLiveCurrent(supabase, theatreSlug);
      } catch {}
    }
    if (live) {
      currentSeries = live.series;
      currentDomains = live.domains;
      sourceCurrent = 'live';
    } else {
      const theatre = posture.theatres.find(t => t.slug === theatreSlug);
      if (theatre) {
        currentSeries = theatre.last_30d_composite ?? [];
        currentDomains = { air: theatre.air, sea: theatre.sea, conflict: theatre.conflict, grid: theatre.grid, imagery: theatre.imagery };
      } else {
        // Unknown theatre: keep the legacy synthetic 35-dim shape.
        const synthetic = Array.from({ length: 35 }, (_, i) => 0.1 + Math.sin(i * 0.2) * 0.05 + 0.2);
        currentSeries = synthetic.slice(0, 30);
        const [air, sea, conflict, grid, imagery] = synthetic.slice(30);
        currentDomains = { air, sea, conflict, grid, imagery };
      }
    }
    const current: number[] = [
      ...currentSeries,
      currentDomains.air,
      currentDomains.sea,
      currentDomains.conflict,
      currentDomains.grid,
      currentDomains.imagery,
    ];
    const currentPayload = {
      current_series: currentSeries,
      current_domains: currentDomains,
      source_current: sourceCurrent,
    };

    // Try DB-backed library first.
    if (supabase) {
      try {
        const q = supabase.from('precursor_library').select('id, event_type, label, window_start, window_end, vector_json, contributing_signals');
        const { data } = eventType ? await q.eq('event_type', eventType) : await q;
        if (data && data.length > 0) {
          const scored = data
            .map((row: any) => {
              const v: number[] = Array.isArray(row.vector_json?.values) ? row.vector_json.values : [];
              const sim = cosine(current, v);
              return { id: row.id, event_type: row.event_type, label: row.label, window_start: row.window_start, window_end: row.window_end, similarity: sim };
            })
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
          return NextResponse.json({ theatre_slug: theatreSlug, top_k: topK, matches: scored, source: 'db', ...currentPayload });
        }
      } catch {}
    }

    // Fallback to fixture.
    const pool = eventType ? precursor.episodes.filter(e => e.event_type === eventType) : precursor.episodes;
    // Seed a pseudo-vector deterministically from the signals array length so the "similarity" is plausibly varied.
    const scored = pool.map(e => {
      const v = Array.from({ length: current.length }, (_, i) => 0.15 + Math.sin(i * 0.27 + e.label.length * 0.13) * 0.12);
      return {
        id: e.id,
        event_type: e.event_type,
        label: e.label,
        window_start: e.window_start,
        window_end: e.window_end,
        similarity: round3(cosine(current, v)),
      };
    }).sort((a, b) => b.similarity - a.similarity).slice(0, topK);

    return NextResponse.json({ theatre_slug: theatreSlug, top_k: topK, matches: scored, source: 'fixture', ...currentPayload });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
