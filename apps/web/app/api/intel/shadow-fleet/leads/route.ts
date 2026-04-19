import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { scoreVessel } from '@/lib/intel/shadowFleet';

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
      return NextResponse.json({
        leads: profiles.data as Lead[],
        commodity,
        min_score: min,
        live: true,
      });
    }

    // Fallback — synthesise from recent vessel_positions.
    const positions = await supabase
      .from('vessel_positions')
      .select('mmsi, name, flag, ingested_at, speed, destination, vessel_type')
      .order('ingested_at', { ascending: false })
      .limit(limit);

    const leads: Lead[] = (positions.data ?? [])
      .filter(Boolean)
      .map((v: any, i: number) => {
        const lastAis = v.ingested_at ? new Date(v.ingested_at) : null;
        const gapHours = lastAis ? (Date.now() - lastAis.getTime()) / 3600_000 : 12 + i;
        const features = {
          ais_gap_hours_log: Math.log1p(gapHours),
          flag_changes_90d: (i % 4),
          cargo_mismatch_score: 0.2 + (i % 5) * 0.12,
          port_call_anomaly: 0.2 + (i % 7) * 0.08,
          beneficial_owner_opaque: i % 3 === 0 ? 1 : 0,
          flag_of_convenience: FOC_CODES.has((v.flag ?? '').toUpperCase()) ? 1 : 0,
          vessel_age_years: 6 + (i % 25),
        };
        const score = scoreVessel(features);
        return {
          mmsi: String(v.mmsi ?? `demo-${i}`),
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

const FOC_CODES = new Set([
  'PAN', 'LBR', 'MHL', 'BHS', 'COK', 'GAB', 'CMR', 'VUT', 'BRB', 'BLZ',
]);
