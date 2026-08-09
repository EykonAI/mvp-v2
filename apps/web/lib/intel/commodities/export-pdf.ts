// ─── PDF renderers for the Commodities workspace footer actions ────
//
// Two deterministic documents (PR 2, D5 — Grounding Brief 2026-08-09
// rev. B): the workspace snapshot and the compliance review. Reuses
// pdfkit + BRAND_TOKENS, mirroring lib/analyst/export-session-pdf.ts.
// NO LLM CONTENT in either — every number is the panel payload, with
// its source and window printed beside it. The export is a citable
// artifact: a reader can re-derive every figure from the named source.

import PDFDocument from 'pdfkit';
import { BRAND_TOKENS } from '@/lib/brand/tokens';
import type { MarketsPayload } from './markets';
import type { LivePayload } from './live';
import type { ShipmentsPayload } from './shipments';

const PAGE_MARGIN = 56;
const FONT_BODY = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_MONO = 'Courier';
const SIZES = { wordmark: 14, title: 13, h2: 11, body: 10, small: 8 };
const COLORS = {
  ink: BRAND_TOKENS.print.ink,
  inkDim: BRAND_TOKENS.print.inkDim,
  accent: BRAND_TOKENS.print.accent,
  rule: BRAND_TOKENS.print.rule,
};

export interface WorkspaceSnapshot {
  commodity: string;
  generated_at: string;
  markets: MarketsPayload;
  live: LivePayload;
  shipments: ShipmentsPayload | null;
}

function newDoc(title: string): PDFKit.PDFDocument {
  return new PDFDocument({
    size: 'LETTER',
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN + 24, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: {
      Title: `eYKON Intelligence — ${title}`,
      Author: BRAND_TOKENS.product.wordmark,
      Subject: 'Commodities workspace snapshot',
      Creator: BRAND_TOKENS.product.name,
    },
  });
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, title: string, generatedAt: string) {
  doc.font(FONT_BOLD).fontSize(SIZES.wordmark).fillColor(COLORS.accent).text(BRAND_TOKENS.product.wordmark);
  doc.moveDown(0.2);
  doc.font(FONT_BOLD).fontSize(SIZES.title).fillColor(COLORS.ink).text(title);
  doc.font(FONT_BODY).fontSize(SIZES.small).fillColor(COLORS.inkDim)
    .text(`Generated ${generatedAt} · every figure carries its source and window · AIS-derived content is inference, stated per row`);
  doc.moveDown(0.6);
  rule(doc);
}

function rule(doc: PDFKit.PDFDocument) {
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y)
    .strokeColor(COLORS.rule).lineWidth(0.5).stroke();
  doc.moveDown(0.4);
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.5);
  doc.font(FONT_BOLD).fontSize(SIZES.h2).fillColor(COLORS.ink).text(title.toUpperCase());
  doc.moveDown(0.2);
}

function line(doc: PDFKit.PDFDocument, text: string, opts: { dim?: boolean; mono?: boolean } = {}) {
  doc.font(opts.mono ? FONT_MONO : FONT_BODY).fontSize(opts.mono ? SIZES.small + 1 : SIZES.body)
    .fillColor(opts.dim ? COLORS.inkDim : COLORS.ink).text(text);
}

export async function renderWorkspaceSnapshotPdf(snap: WorkspaceSnapshot): Promise<Buffer> {
  const doc = newDoc(`Commodities — ${snap.commodity.toUpperCase()}`);
  header(doc, `Commodities workspace snapshot · ${snap.commodity.toUpperCase()}`, snap.generated_at);

  const m = snap.markets;

  section(doc, '01 · Production & export share');
  if (m.export_shares) {
    line(doc, `${m.export_shares.source} · ${m.export_shares.period} · ${m.export_shares.basis} · layer: ${m.export_shares.layer}`, { dim: true });
    for (const r of m.export_shares.rows) {
      line(doc, `${r.reporter.padEnd(22)} ${(r.share * 100).toFixed(1)}%${r.value != null ? `  (${r.value} ${r.unit ?? ''})` : ''}`, { mono: true });
    }
    for (const n of m.export_shares.notes ?? []) line(doc, `note: ${n}`, { dim: true });
  } else {
    line(doc, 'No sourced rows for this slug yet.', { dim: true });
  }

  section(doc, '02 · Price, volatility, futures');
  if (m.prices) {
    line(doc, `Spot ${m.prices.latest.value} ${m.prices.unit} · ${m.prices.latest.period} · ${m.prices.source} (${m.prices.cadence})`);
  } else {
    line(doc, 'No sourced price series.', { dim: true });
  }
  if (m.volatility_30d) line(doc, `30d realized volatility ${m.volatility_30d.pct}% — ${m.volatility_30d.method}`, { dim: true });
  if (m.futures) {
    line(doc, `${m.futures.label} · ${m.futures.period} · ${m.futures.structure}`);
    line(doc, m.futures.points.map(p => `M${p.month} ${p.price}`).join('   ') + ` ${m.futures.unit}`, { mono: true });
    if (m.futures.benchmark_note) line(doc, m.futures.benchmark_note, { dim: true });
  }

  section(doc, '03 · Chokepoint transits');
  for (const cp of snap.live.chokepoints ?? []) {
    if (cp.no_data) {
      line(doc, `${cp.label.padEnd(14)} NO DATA · ${cp.days_since}d  (last observed ${cp.latest_count} on ${cp.latest_period})`, { mono: true });
    } else {
      line(doc, `${cp.label.padEnd(14)} ${String(cp.latest_count).padStart(5)}  ${cp.delta_pct != null ? `${cp.delta_pct >= 0 ? '+' : ''}${cp.delta_pct}% vs trailing avg` : ''}`, { mono: true });
    }
  }
  line(doc, 'free-tier AIS · ingest-sensitive · baseline covered days only', { dim: true });

  section(doc, '04 · Sanction risk (computed)');
  if (m.sanction_risk) {
    for (const r of m.sanction_risk.rows) {
      const trend = r.designation_delta_90d != null
        ? ` · Δ90d ${r.designation_delta_90d >= 0 ? '+' : ''}${r.designation_delta_90d}`
        : '';
      line(doc, `${r.country.padEnd(22)} ${String(r.ofac_active_designations ?? '—').padStart(6)} OFAC${trend} · ${r.band.toUpperCase()}`, { mono: true });
    }
    line(doc, m.sanction_risk.method, { dim: true });
  }

  if (snap.shipments) {
    section(doc, '07 · Shipments (AIS-inferred)');
    if (!snap.shipments.supported) {
      line(doc, snap.shipments.reason ?? 'Not supportable on the current AIS tier.', { dim: true });
    } else {
      for (const r of snap.shipments.rows.slice(0, 8)) {
        line(doc, `${(r.vessel_name ?? r.mmsi).padEnd(22)} ${(r.flag ?? '—').padEnd(4)} ${(r.origin_port ?? '—').padEnd(18)} → ${(r.destination ?? 'unknown').padEnd(16)} ${r.confidence.toUpperCase()}`, { mono: true });
      }
      if (snap.shipments.feed_stale_days) line(doc, `AIS feed stale ${snap.shipments.feed_stale_days}d — rows describe the last covered window`, { dim: true });
      line(doc, snap.shipments.inference_note, { dim: true });
    }
  }

  if (snap.live.eia) {
    section(doc, '06 · Cushing crude stocks (EIA weekly)');
    line(doc, `${snap.live.eia.latest.value.toLocaleString()} ${snap.live.eia.unit} · week of ${snap.live.eia.latest.period}${snap.live.eia.weekly_delta_pct != null ? ` · ${snap.live.eia.weekly_delta_pct >= 0 ? '+' : ''}${snap.live.eia.weekly_delta_pct}% w/w` : ''}`);
  }

  doc.moveDown(0.8);
  rule(doc);
  line(doc, 'Deterministic snapshot — no generated prose. Panels with ILLUSTRATIVE badges are excluded from this export.', { dim: true });

  return collect(doc);
}

export interface ComplianceData {
  commodity: string;
  generated_at: string;
  sanction_risk: NonNullable<MarketsPayload['sanction_risk']>;
}

export async function renderCompliancePdf(data: ComplianceData): Promise<Buffer> {
  const doc = newDoc(`Compliance review — ${data.commodity.toUpperCase()}`);
  header(doc, `Sanctions exposure snapshot · ${data.commodity.toUpperCase()} exporter set`, data.generated_at);

  line(doc, 'Deterministic report: active OFAC SDN designations per country-linked program set, with the measured designation trend. No model output, no generated prose — every count is reproducible against the OFAC SDN list as ingested.', { dim: true });

  for (const r of data.sanction_risk.rows) {
    section(doc, `${r.country} — ${r.band.toUpperCase()}`);
    line(doc, `Active OFAC designations: ${r.ofac_active_designations ?? 'n/a'}`);
    if (r.designation_delta_90d != null) {
      line(doc, `Change over ${data.sanction_risk.trend_window_days}d: ${r.designation_delta_90d >= 0 ? '+' : ''}${r.designation_delta_90d} (measured from first_seen/removed history — not a prediction)`);
    } else if (data.sanction_risk.trend_clamped_to) {
      line(doc, `Trend unavailable: OFAC ingest history begins ${data.sanction_risk.trend_clamped_to.slice(0, 10)} — window not yet covered`, { dim: true });
    }
    line(doc, `Conflict fatalities (30d, GDELT): ${r.fatalities_30d ?? 'n/a'} · conflict events (context only): ${r.conflict_events_30d ?? 'n/a'}`);
    if (r.ofac_programs_matched.length) {
      line(doc, `Programs matched: ${r.ofac_programs_matched.join(', ')}`, { mono: true });
    } else {
      line(doc, 'No country-linked OFAC program set — count reads 0 by construction.', { dim: true });
    }
  }

  doc.moveDown(0.8);
  rule(doc);
  line(doc, `Method — ${data.sanction_risk.method}`, { dim: true });
  line(doc, 'This snapshot is generated from the OFAC SDN list as ingested by eYKON and is not legal advice.', { dim: true });

  return collect(doc);
}
