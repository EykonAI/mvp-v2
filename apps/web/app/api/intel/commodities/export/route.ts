import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/analyst/access';
import { buildMarketsPayload } from '@/lib/intel/commodities/markets';
import { buildLivePayload } from '@/lib/intel/commodities/live';
import { buildShipmentsPayload } from '@/lib/intel/commodities/shipments';
import { renderWorkspaceSnapshotPdf } from '@/lib/intel/commodities/export-pdf';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * Export PDF + JSON (footer action, PR 2 D5).
 *
 * Deterministic snapshot of the live panel payloads — the JSON replays
 * the exact objects the panels render (same builder functions, no
 * drift possible); the PDF prints them with source + window beside
 * every figure. No LLM content. Pro-gated: the workspace itself is a
 * Pro surface, and the export is a citable work product.
 */
export async function GET(req: NextRequest) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;

  const commodity = req.nextUrl.searchParams.get('commodity') ?? '';
  const format = req.nextUrl.searchParams.get('format') ?? 'json';

  const markets = await buildMarketsPayload(commodity);
  if (!markets) {
    return NextResponse.json({ error: `unknown commodity '${commodity}'` }, { status: 400 });
  }
  const [live, shipments] = await Promise.all([
    buildLivePayload(),
    buildShipmentsPayload(commodity),
  ]);

  const snapshot = {
    commodity,
    generated_at: new Date().toISOString(),
    note: 'Deterministic snapshot of the Commodities workspace payloads. Every figure carries its source and window; AIS-derived content is inference and is labeled per row.',
    markets,
    live,
    shipments,
  };

  if (format === 'pdf') {
    const pdf = await renderWorkspaceSnapshotPdf(snapshot);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="eykon-commodities-${commodity}-${snapshot.generated_at.slice(0, 10)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="eykon-commodities-${commodity}-${snapshot.generated_at.slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
