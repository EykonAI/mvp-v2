import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { scoreVessel, computeRealFeatures } from '@/lib/intel/shadowFleet';

export const dynamic = 'force-dynamic';

interface Lead {
  mmsi: string;
  name: string;
  imo: string | null;
  flag: string;
  dwt: number | null;
  composite_score: number;
  indicators: Record<string, number>;
  last_ais_at: string | null;
  last_dark_hours: number;
}

/**
 * Ranked shadow-fleet leads. Reads vessel_profiles when the
 * Phase-7 scoring cron has populated it; otherwise synthesises a
 * demo list from current vessel_positions so the workspace is
 * usable immediately.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const commodity = url.searchParams.get('commodity') ?? 'oil';
  const min = Number(url.searchParams.get('min_score') ?? 0.4);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

  try {
    const supabase = createServerSupabase();

    // Prefer materialised profiles if present.
    const profiles = await supabase
      .from('vessel_profiles')
      .select('*')
      .gte('composite_score', min)
      .order('composite_score', { ascending: false })
      .limit(limit);

    if (!profiles.error && profiles.data && profiles.data.length > 0) {
      const leads: Lead[] = profiles.data.map((p: any) => ({
        ...p,
        last_dark_hours: p.last_ais_at
          ? Math.round(Math.max(0, (Date.now() - new Date(p.last_ais_at).getTime()) / 3600_000))
          : 0,
      }));
      return NextResponse.json({ leads, commodity, min_score: min, live: true });
    }

    // Fallback — recent vessel_positions scored with the SAME real-signal
    // model (AIS dark-gap + flag-of-convenience). No synthetic features.
    const positions = await supabase
      .from('vessel_positions')
      .select('mmsi, name, flag, ingested_at')
      .order('ingested_at', { ascending: false })
      .limit(500);

    const rows = (positions.data ?? []).filter(Boolean);
    // Data clock = freshest observation, so a stalled feed doesn't flag everything.
    const dataClock = rows.length ? new Date(rows[0].ingested_at).getTime() : Date.now();

    const leads: Lead[] = rows
      .map((v: any) => {
        const gapHours = v.ingested_at
          ? Math.max(0, (dataClock - new Date(v.ingested_at).getTime()) / 3600_000)
          : 0;
        const features = computeRealFeatures({ flag: v.flag, gapHours });
        const score = scoreVessel(features);
        return {
          mmsi: String(v.mmsi ?? 'unknown'),
          name: v.name ?? 'Unknown vessel',
          imo: null,
          flag: v.flag ?? 'UNK',
          dwt: null,
          composite_score: score.composite,
          indicators: features as unknown as Record<string, number>,
          last_ais_at: v.ingested_at ?? null,
          last_dark_hours: Math.round(gapHours),
        };
      })
      .filter(l => l.composite_score >= min)
      .sort((a, b) => b.composite_score - a.composite_score)
      .slice(0, limit);

    return NextResponse.json({ leads, commodity, min_score: min, live: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ leads: [], error: message }, { status: 200 });
  }
}
