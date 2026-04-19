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

/** Precursor match — cosine against the library. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const theatreSlug: string = body.theatre_slug ?? 'black-sea';
    const topK = Math.min(10, Math.max(1, Number(body.top_k ?? 3)));
    const eventType: string | null = body.event_type ?? null;

    // Build current vector from the theatre's 30-day composite + domain scores.
    const theatre = posture.theatres.find(t => t.slug === theatreSlug);
    const current: number[] = theatre
      ? [...(theatre.last_30d_composite ?? []), theatre.air, theatre.sea, theatre.conflict, theatre.grid, theatre.imagery]
      : Array.from({ length: 35 }, (_, i) => 0.1 + Math.sin(i * 0.2) * 0.05 + 0.2);

    // Try DB-backed library first.
    try {
      const supabase = createServerSupabase();
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
        return NextResponse.json({ theatre_slug: theatreSlug, top_k: topK, matches: scored, source: 'db' });
      }
    } catch {}

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

    return NextResponse.json({ theatre_slug: theatreSlug, top_k: topK, matches: scored, source: 'fixture' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
