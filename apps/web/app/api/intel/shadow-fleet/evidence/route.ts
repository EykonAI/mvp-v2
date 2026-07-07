import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { FOC_CODES } from '@/lib/intel/shadowFleet';

export const dynamic = 'force-dynamic';

/**
 * Per-vessel evidence for the Shadow Fleet workspace, built ONLY from data we
 * actually hold: the current AIS snapshot (vessel_positions — one row per
 * mmsi, no history) and the scored profile (vessel_profiles). No time-series,
 * no registry history, no port calls — the UI shows honest placeholders for
 * those until the data layers exist.
 */

const NAV_STATUS_LABELS: Record<number, string> = {
  0: 'under way',
  1: 'at anchor',
  2: 'not under command',
  3: 'restricted manoeuvre',
  5: 'moored',
  8: 'under way (sailing)',
};

function navStatusLabel(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  return NAV_STATUS_LABELS[code] ?? String(code);
}

export async function GET(req: NextRequest) {
  const mmsi = new URL(req.url).searchParams.get('mmsi');
  if (!mmsi) {
    return NextResponse.json({ error: 'mmsi query parameter required' }, { status: 200 });
  }

  try {
    const supabase = createServerSupabase();

    const [pos, prof] = await Promise.all([
      supabase
        .from('vessel_positions')
        .select('mmsi, name, imo, flag, destination, speed, heading, nav_status, longitude, latitude, updated_at, ingested_at')
        .eq('mmsi', mmsi)
        .maybeSingle(),
      supabase
        .from('vessel_profiles')
        .select('mmsi, name, imo, flag, dwt, built_year, composite_score, indicators, last_ais_at, last_dark_at')
        .eq('mmsi', mmsi)
        .maybeSingle(),
    ]);

    const p: any = pos.data ?? null;
    const pr: any = prof.data ?? null;

    if (!p && !pr) {
      return NextResponse.json(
        { error: `No live record for MMSI ${mmsi} in vessel_positions or vessel_profiles` },
        { status: 200 },
      );
    }

    const flag = p?.flag ?? pr?.flag ?? null;

    // Last contact = freshest of the snapshot's two timestamps.
    const stamps = [p?.updated_at, p?.ingested_at]
      .filter(Boolean)
      .map((t: string) => new Date(t).getTime())
      .filter(t => Number.isFinite(t));
    const lastContactMs = stamps.length ? Math.max(...stamps) : null;
    const hoursSinceContact =
      lastContactMs !== null ? Math.max(0, (Date.now() - lastContactMs) / 3600_000) : null;

    return NextResponse.json({
      mmsi,
      identity: {
        name: p?.name ?? pr?.name ?? null,
        imo: p?.imo ?? pr?.imo ?? null,
        flag,
        foc: FOC_CODES.has((flag ?? '').toUpperCase()),
        dwt: pr?.dwt ?? null,
        built_year: pr?.built_year ?? null,
      },
      telemetry: {
        destination: p?.destination ?? null,
        speed: p?.speed ?? null,
        heading: p?.heading ?? null,
        nav_status: p?.nav_status ?? null,
        nav_status_label: navStatusLabel(p?.nav_status),
        latitude: p?.latitude ?? null,
        longitude: p?.longitude ?? null,
      },
      contact: {
        last_contact_at: lastContactMs !== null ? new Date(lastContactMs).toISOString() : null,
        hours_since_contact: hoursSinceContact !== null ? Math.round(hoursSinceContact * 10) / 10 : null,
        dark_gap_open: hoursSinceContact !== null && hoursSinceContact > 6,
        last_dark_at: pr?.last_dark_at ?? null,
        last_ais_at: pr?.last_ais_at ?? null,
      },
      score: {
        composite_score: pr?.composite_score ?? null,
        indicators: pr?.indicators ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
