import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { S1_NOTE, groupReadings, s1Credit, type S1Payload, type S1State } from '@/lib/imagery/s1-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Sentinel-1 radar at the straits and admitted anchorages (Imagery IMG-6,
 * mig 189). Returns the admission state and, ONLY when the latest recorded
 * admission passed, the last passes per site — VOID passes included as
 * "no look". Until then: the state and an empty list, never a figure.
 */
export async function GET() {
  try {
    const supabase = createServerSupabase();
    const [st, rd] = await Promise.all([
      supabase.rpc('imagery_s1_status'),
      supabase.rpc('imagery_s1_readings', { p_days: 30 }),
    ]);
    if (st.error) return NextResponse.json({ error: `imagery_s1_status: ${st.error.message}` }, { status: 502 });
    if (rd.error) return NextResponse.json({ error: `imagery_s1_readings: ${rd.error.message}` }, { status: 502 });
    const s = (st.data as Array<Record<string, any>> | null)?.[0];
    const state = (s?.state ?? 'no admission recorded') as S1State;
    const body: S1Payload = {
      state,
      admission: s?.admission_id
        ? {
            id: Number(s.admission_id),
            recorded_at: String(s.recorded_at),
            evaluated_n: Number(s.evaluated_n),
            admitted_n: Number(s.admitted_n),
            m2_per_vessel: s.m2_per_vessel === null ? null : Number(s.m2_per_vessel),
          }
        : null,
      sites: state === 'admitted' ? groupReadings((rd.data ?? []) as any[]) : [],
      note: S1_NOTE,
      credit: s1Credit(),
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
