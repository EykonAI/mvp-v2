// ─── PDF renderer for Intelligence-Analyst query exports ─────────
// Produces a polished, third-party-presentable PDF of one history
// entry per §3.4 of the brief: header (eYKON wordmark + query) ·
// body (formatted response) · provenance block (tools + timestamps)
// · footer (page number + generated-at).
//
// Reuses the existing pdfkit dependency (apps/web/package.json) per
// brief §6.5. No new deps. Default Helvetica font — bundling Jura/
// IBM Plex TTFs is deferred (would balloon the bundle by ~600 KB).

import PDFDocument from 'pdfkit';
import { BRAND_TOKENS } from '@/lib/brand/tokens';
import type { ToolCallSummary } from './relevance';

export interface PdfRenderInput {
  queryText: string;
  responseText: string;
  toolCalls: ToolCallSummary[];
  fetchedAtIso: string; // when the row was last_run_at; the "as-of" of the data
  generatedAtIso: string; // now()
}

const PAGE_MARGIN = 56; // 0.78 inch — comfortable for letter-size
const FONT_BODY = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_MONO = 'Courier';

const SIZES = {
  wordmark: 14,
  query:    12,
  h1:       13,
  h2:       11,
  body:     10,
  small:    8,
  footer:   8,
};

const COLORS = {
  ink:    BRAND_TOKENS.print.ink,
  inkDim: BRAND_TOKENS.print.inkDim,
  accent: BRAND_TOKENS.print.accent,
  rule:   BRAND_TOKENS.print.rule,
};

/**
 * Render the PDF and return a single Buffer. Done in-memory rather
 * than streamed — the documents are small (a few pages) and Next
 * route handlers expect a complete body anyway.
 */
export async function renderQueryPdf(input: PdfRenderInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN + 24, left: PAGE_MARGIN, right: PAGE_MARGIN },
      bufferPages: true,
      info: {
        Title: `eYKON Intelligence — ${truncate(input.queryText, 60)}`,
        Author: BRAND_TOKENS.product.wordmark,
        Subject: 'Geopolitical intelligence query export',
        Creator: BRAND_TOKENS.product.name,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawHeader(doc, input);
      drawBody(doc, input.responseText);
      drawProvenance(doc, input);
      drawFooters(doc, input.generatedAtIso);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Sections ────────────────────────────────────────────────────

function drawHeader(doc: PDFKit.PDFDocument, input: PdfRenderInput) {
  // eYKON wordmark + tagline
  doc
    .font(FONT_BOLD)
    .fontSize(SIZES.wordmark)
    .fillColor(COLORS.ink)
    .text(BRAND_TOKENS.product.wordmark, { continued: true })
    .font(FONT_BODY)
    .fontSize(SIZES.small)
    .fillColor(COLORS.inkDim)
    .text(`  ·  ${BRAND_TOKENS.product.tagline}`);

  doc.moveDown(0.6);
  ruleLine(doc, COLORS.accent, 1.2);

  // Query text — verbatim, larger
  doc.moveDown(0.6);
  doc
    .font(FONT_BODY)
    .fontSize(SIZES.small)
    .fillColor(COLORS.inkDim)
    .text('Query', { characterSpacing: 1.5 });
  doc
    .moveDown(0.15)
    .font(FONT_BOLD)
    .fontSize(SIZES.query)
    .fillColor(COLORS.ink)
    .text(input.queryText, { lineGap: 2 });
  doc.moveDown(0.8);
}

function drawBody(doc: PDFKit.PDFDocument, responseText: string) {
  // Response heading
  doc
    .font(FONT_BODY)
    .fontSize(SIZES.small)
    .fillColor(COLORS.inkDim)
    .text('Response', { characterSpacing: 1.5 });
  doc.moveDown(0.3);

  // Lightweight markdown rendering: headings (lines starting with #),
  // bullets (- or *), and paragraphs. No HTML, no nested lists.
  const lines = responseText.split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') {
      doc.moveDown(0.4);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = stripInlineMarkdown(heading[2]);
      doc
        .font(FONT_BOLD)
        .fontSize(level === 1 ? SIZES.h1 : SIZES.h2)
        .fillColor(COLORS.ink)
        .text(text, { lineGap: 2 });
      doc.moveDown(0.2);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      doc
        .font(FONT_BODY)
        .fontSize(SIZES.body)
        .fillColor(COLORS.ink)
        .text('•  ' + stripInlineMarkdown(bullet[1]), {
          indent: 8,
          lineGap: 1.5,
        });
      continue;
    }
    doc
      .font(FONT_BODY)
      .fontSize(SIZES.body)
      .fillColor(COLORS.ink)
      .text(stripInlineMarkdown(line), { lineGap: 2 });
  }
  doc.moveDown(0.5);
}

function drawProvenance(doc: PDFKit.PDFDocument, input: PdfRenderInput) {
  doc.moveDown(0.4);
  ruleLine(doc, COLORS.rule, 0.5);
  doc.moveDown(0.4);

  doc
    .font(FONT_BODY)
    .fontSize(SIZES.small)
    .fillColor(COLORS.inkDim)
    .text('Provenance', { characterSpacing: 1.5 });
  doc.moveDown(0.3);

  if (!input.toolCalls || input.toolCalls.length === 0) {
    doc
      .font(FONT_BODY)
      .fontSize(SIZES.small)
      .fillColor(COLORS.inkDim)
      .text('No tool calls — response synthesised from the model only.');
  } else {
    for (const tc of input.toolCalls) {
      const inputJson = compactJson(tc.input);
      const rowCount = tc.row_count == null ? '—' : `${tc.row_count} rows`;
      doc
        .font(FONT_BOLD)
        .fontSize(SIZES.small)
        .fillColor(COLORS.ink)
        .text(`${tc.name}`, { continued: true })
        .font(FONT_BODY)
        .fillColor(COLORS.inkDim)
        .text(`  ·  ${rowCount}`);
      doc
        .font(FONT_MONO)
        .fontSize(SIZES.small)
        .fillColor(COLORS.inkDim)
        .text(inputJson, { indent: 8, lineGap: 1 });
      doc.moveDown(0.25);
    }
  }

  doc.moveDown(0.3);
  doc
    .font(FONT_BODY)
    .fontSize(SIZES.small)
    .fillColor(COLORS.inkDim)
    .text(`Data fetched at ${formatIso(input.fetchedAtIso)} UTC`);
}

function drawFooters(doc: PDFKit.PDFDocument, generatedAtIso: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - PAGE_MARGIN + 14;
    doc
      .font(FONT_BODY)
      .fontSize(SIZES.footer)
      .fillColor(COLORS.inkDim)
      .text(
        `${BRAND_TOKENS.product.confidential} · ${formatIso(generatedAtIso)} UTC`,
        PAGE_MARGIN,
        bottom,
        { width: doc.page.width - PAGE_MARGIN * 2, align: 'left', lineBreak: false },
      );
    doc
      .font(FONT_BODY)
      .fontSize(SIZES.footer)
      .fillColor(COLORS.inkDim)
      .text(
        `Page ${i - range.start + 1} of ${range.count}`,
        PAGE_MARGIN,
        bottom,
        { width: doc.page.width - PAGE_MARGIN * 2, align: 'right', lineBreak: false },
      );
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function ruleLine(doc: PDFKit.PDFDocument, color: string, width: number) {
  const y = doc.y;
  doc
    .strokeColor(color)
    .lineWidth(width)
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .stroke();
  doc.moveDown(0.1);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function stripInlineMarkdown(s: string): string {
  // Strip bold/italic/code markers — the rendered glyphs would
  // confuse readers (PDF doesn't honour the markdown).
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function compactJson(obj: unknown): string {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= 200) return s;
    return s.slice(0, 197) + '…';
  } catch {
    return '{}';
  }
}

function formatIso(iso: string): string {
  try {
    return new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  } catch {
    return iso;
  }
}

/**
 * Slug for the export filename — first 6 words, lowercase,
 * non-alphanumerics collapsed to hyphens.
 */
export function exportFilename(queryText: string, dateIso: string): string {
  const yyyymmdd = dateIso.slice(0, 10).replace(/-/g, '');
  const slug =
    queryText
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 6)
      .join(' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'query';
  return `eykon-intelligence-${slug}-${yyyymmdd}.pdf`;
}
