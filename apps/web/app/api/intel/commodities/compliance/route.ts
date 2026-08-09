import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/analyst/access';
import { buildMarketsPayload } from '@/lib/intel/commodities/markets';
import { renderCompliancePdf } from '@/lib/intel/commodities/export-pdf';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * Compliance review (footer action, PR 2 D5) — DETERMINISTIC, no LLM.
 *
 * An OFAC exposure snapshot for the selected commodity's exporter set:
 * active designation counts per country-linked program set, the
 * measured 90d designation trend, band rationale, and the exact
 * program codes matched — rendered to PDF. Every count is reproducible
 * against the OFAC SDN list as ingested; a compliance officer can
 * check the document, which is the point. An LLM essay would not be
 * checkable and therefore does not belong here.
 */
export async function GET(req: NextRequest) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;

  const commodity = req.nextUrl.searchParams.get('commodity') ?? '';
  const markets = await buildMarketsPayload(commodity);
  if (!markets) {
    return NextResponse.json({ error: `unknown commodity '${commodity}'` }, { status: 400 });
  }
  if (!markets.sanction_risk) {
    return NextResponse.json(
      { error: 'sanction-risk computation unavailable — OFAC and conflict feeds could not be read' },
      { status: 503 },
    );
  }

  const generatedAt = new Date().toISOString();
  const pdf = await renderCompliancePdf({
    commodity,
    generated_at: generatedAt,
    sanction_risk: markets.sanction_risk,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="eykon-compliance-${commodity}-${generatedAt.slice(0, 10)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
