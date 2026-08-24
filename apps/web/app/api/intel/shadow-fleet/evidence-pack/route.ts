import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { requireSessionAccess } from '@/lib/analyst/access';
import { renderEvidencePackPdf } from '@/lib/intel/evidencePackPdf';
import { boxState, type BoxLiveness } from '@/lib/intel/aisCoverage';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * Export one dark-contact event as a branded evidence-pack PDF.
 *
 * Pro-gated like the commodities export: the workspace is a Pro surface and
 * the export is a citable work product. No LLM content — the document is a
 * deterministic print of the event row, the score arithmetic, and the
 * coverage state, with the honesty invariants on the page (an exported PDF
 * travels without the UI that would otherwise gloss still_dark correctly).
 */
export async function GET(req: NextRequest) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;

  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  try {
    const supabase = createServerSupabase();
    const { data: ev, error } = await supabase
      .from('dark_contact_events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle();
    if (error || !ev) {
      return NextResponse.json({ error: error?.message ?? `no event ${eventId}` }, { status: 404 });
    }

    const [liveness, track] = await Promise.all([
      ev.box_slug
        ? supabase.from('ais_box_liveness').select('*').eq('slug', ev.box_slug).maybeSingle()
        : Promise.resolve({ data: null } as any),
      supabase
        .from('ais_position_history')
        .select('id', { count: 'exact', head: true })
        .eq('mmsi', ev.mmsi)
        .gte('recorded_at', new Date(Date.now() - 14 * 24 * 3600_000).toISOString()),
    ]);

    const lv = liveness.data as BoxLiveness | null;
    const pdf = await renderEvidencePackPdf({
      event: ev as any,
      boxState: lv
        ? {
            label: lv.label,
            state: boxState(lv),
            silent_hours: lv.newest_fix
              ? Math.round(((Date.now() - new Date(lv.newest_fix).getTime()) / 3600_000) * 10) / 10
              : null,
          }
        : null,
      trackFixCount: track.count ?? 0,
      generatedAtIso: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    });

    const safeName = (ev.name ?? ev.mmsi).toString().replace(/[^A-Za-z0-9_-]+/g, '_');
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="eYKON-evidence-pack-${safeName}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
