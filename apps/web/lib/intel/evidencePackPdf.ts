// ─── Dark-contact evidence pack PDF (Shadow Fleet PR G) ───────────
//
// One event, rendered as a third-party-presentable dossier: identity,
// lifecycle, the full score arithmetic (recomputable by eye — same rule as
// the on-screen panel), coverage state at export time, and the honesty
// invariants stated on the document itself rather than assumed. Mirrors the
// pdfkit + BRAND_TOKENS conventions of export-session-pdf.ts; no new deps.
//
// The invariants travel WITH the evidence because the reader of an exported
// PDF has none of the surrounding UI: still_dark must be glossed
// "not re-observed by eYKON coverage" on the page, or the export claims more
// than the instrument saw.

import PDFDocument from 'pdfkit';
import { BRAND_TOKENS } from '@/lib/brand/tokens';
import weights from '@/lib/fixtures/shadow_fleet_weights.json';

export interface EvidencePackInput {
  event: {
    id: string;
    mmsi: string;
    name: string | null;
    flag: string | null;
    box_slug: string | null;
    last_fix_lat: number | null;
    last_fix_lon: number | null;
    last_speed_kn: number | null;
    cadence_hours: number;
    silence_ratio_at_open: number;
    confidence_at_open: number;
    indicators: Record<string, number> | null;
    gap_started_at: string;
    opened_at: string;
    deadline_at: string;
    status: string;
    resolution: string | null;
    void_reason: string | null;
    closed_at: string | null;
    final_gap_hours: number | null;
  };
  boxState: { label: string; state: string; silent_hours: number | null } | null;
  trackFixCount: number;
  generatedAtIso: string;
}

const M = 56;
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const MONO = 'Courier';
const C = {
  ink: BRAND_TOKENS.print.ink,
  dim: BRAND_TOKENS.print.inkDim,
  accent: BRAND_TOKENS.print.accent,
  rule: BRAND_TOKENS.print.rule,
};

export async function renderEvidencePackPdf(input: EvidencePackInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const ev = input.event;
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: M, bottom: M + 24, left: M, right: M },
      bufferPages: true,
      info: {
        Title: `eYKON Intelligence — Dark-Contact Evidence Pack · ${ev.name ?? ev.mmsi}`,
        Author: BRAND_TOKENS.product.wordmark,
        Subject: 'Shadow Fleet dark-contact event evidence',
        Creator: BRAND_TOKENS.product.name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ──
    doc.font(BOLD).fontSize(14).fillColor(C.accent).text(BRAND_TOKENS.product.wordmark);
    doc.moveDown(0.2);
    doc.font(BOLD).fontSize(13).fillColor(C.ink).text('Dark-Contact Evidence Pack');
    doc.font(FONT).fontSize(8).fillColor(C.dim)
      .text(`Event ${ev.id} · generated ${input.generatedAtIso} · eYKON Shadow Fleet workspace`);
    rule(doc);

    // ── Identity ──
    h2(doc, 'Vessel');
    kv(doc, 'Name', ev.name ?? 'Unknown vessel');
    kv(doc, 'MMSI', ev.mmsi);
    kv(doc, 'Flag', ev.flag ?? '—');
    kv(doc, 'Last known position',
      ev.last_fix_lat != null && ev.last_fix_lon != null
        ? `${ev.last_fix_lat.toFixed(4)}, ${ev.last_fix_lon.toFixed(4)}`
        : '—');
    kv(doc, 'Last reported speed', ev.last_speed_kn != null ? `${ev.last_speed_kn} kn` : '—');
    kv(doc, 'Coverage box at last fix', ev.box_slug ?? 'outside subscription boxes');

    // ── Lifecycle ──
    h2(doc, 'Event lifecycle');
    kv(doc, 'Gap started (last AIS fix)', iso(ev.gap_started_at));
    kv(doc, 'Event opened', iso(ev.opened_at));
    kv(doc, 'Re-observation deadline', iso(ev.deadline_at));
    kv(doc, 'Own cadence (14-day median)', `${ev.cadence_hours.toFixed(1)} h between fixes`);
    kv(doc, 'Silence at open', `${ev.silence_ratio_at_open.toFixed(1)}× own cadence`);
    kv(doc, 'Status', statusLine(ev));
    if (ev.final_gap_hours != null) kv(doc, 'Final gap', `${ev.final_gap_hours.toFixed(1)} h`);

    // Resolution gloss — the honest wording travels with the document.
    doc.moveDown(0.4);
    doc.font(FONT).fontSize(8.5).fillColor(C.dim).text(resolutionGloss(ev), { lineGap: 1.5 });

    // ── Score arithmetic ──
    h2(doc, `Confidence at open — full arithmetic (weights ${ (weights as any).version })`);
    const ind = ev.indicators ?? {};
    let z = (weights as any).intercept as number;
    doc.font(MONO).fontSize(8.5).fillColor(C.ink);
    for (const f of (weights as any).features as Array<{ key: string; weight: number; clip: [number, number] }>) {
      const raw = Number(ind[f.key] ?? 0);
      const v = Math.max(f.clip[0], Math.min(f.clip[1], raw));
      const contrib = v * f.weight;
      z += contrib;
      doc.text(`  ${f.key.padEnd(22)} ${v.toFixed(3)} × ${String(f.weight).padEnd(5)} = ${contrib >= 0 ? '+' : ''}${contrib.toFixed(3)}`);
    }
    doc.text(`  ${'intercept'.padEnd(22)} ${' '.repeat(15)} ${(weights as any).intercept.toFixed(3)}`);
    doc.text(`  z = ${z.toFixed(3)}   →   confidence = 1 / (1 + e^−z) = ${ev.confidence_at_open.toFixed(3)}`);
    if (typeof ind.silence_hours === 'number' && typeof ind.cadence_hours === 'number') {
      doc.moveDown(0.2);
      doc.font(FONT).fontSize(8.5).fillColor(C.dim)
        .text(`At open the vessel had been silent ${ind.silence_hours} h against its own ${ind.cadence_hours} h cadence — ` +
              `${(ind.silence_hours / Math.max(0.5, ind.cadence_hours)).toFixed(1)}× its normal reporting interval.`);
    }

    // ── Coverage at export ──
    h2(doc, 'Coverage state at export');
    if (input.boxState) {
      kv(doc, input.boxState.label,
        input.boxState.state === 'dead'
          ? `DEAD — no AIS for ${input.boxState.silent_hours != null ? (input.boxState.silent_hours / 24).toFixed(1) : '?'} days`
          : `${input.boxState.state.toUpperCase()}${input.boxState.silent_hours != null ? ` — newest fix ${input.boxState.silent_hours} h ago` : ''}`);
    } else {
      kv(doc, 'Box', 'liveness unavailable at export time — stated rather than assumed healthy');
    }
    kv(doc, 'Observed track held', `${input.trackFixCount} real fixes in the last 14 days (never interpolated)`);

    // ── Invariants ──
    h2(doc, 'How to read this document');
    doc.font(FONT).fontSize(8.5).fillColor(C.dim);
    for (const line of [
      'A dark gap is measured from the vessel\'s last received AIS fix against the coverage box\'s own freshest observation — never against a wall clock, and never from database row age.',
      '"Reappeared" is a positive observation: a newer fix arrived, from any coverage box.',
      '"Not re-observed" (still_dark) means no fix reached eYKON\'s AIS coverage by the deadline. It is a statement about the instrument\'s view — a vessel that sailed beyond our coverage is indistinguishable from a dark one.',
      'A VOID event is neither a hit nor a miss: the box measuring the silence went dead, and absence of an observation is not a result.',
      'Attribution (sanctions evasion, dark shipping, transponder manipulation) is inference and belongs to the analyst, never to this record.',
    ]) {
      doc.text(`•  ${line}`, { lineGap: 2 });
      doc.moveDown(0.15);
    }

    rule(doc);
    doc.font(FONT).fontSize(7.5).fillColor(C.dim).text(
      'PROVENANCE — dark_contact_events (event lifecycle) · vessel_positions.updated_at (last contact) · ' +
      'vessel_cadence (14-day median inter-fix interval) · ais_box_liveness (per-box coverage) · AISStream free tier. ' +
      'Identity denormalised at event open. No registry, ownership or cargo record is held for this vessel: absent, not empty.',
      { lineGap: 1.5 },
    );

    // Footer with page numbers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font(FONT).fontSize(8).fillColor(C.dim).text(
        `${BRAND_TOKENS.product.wordmark} · Dark-Contact Evidence Pack · page ${i + 1} of ${range.count}`,
        M, doc.page.height - M + 8, { width: doc.page.width - 2 * M, align: 'center' },
      );
    }
    doc.end();
  });
}

function h2(doc: PDFKit.PDFDocument, t: string) {
  doc.moveDown(0.7);
  doc.font(BOLD).fontSize(10).fillColor(C.accent).text(t.toUpperCase());
  doc.moveDown(0.2);
}
function kv(doc: PDFKit.PDFDocument, k: string, v: string) {
  doc.font(BOLD).fontSize(9).fillColor(C.dim).text(`${k}:  `, { continued: true });
  doc.font(FONT).fillColor(C.ink).text(v);
}
function rule(doc: PDFKit.PDFDocument) {
  doc.moveDown(0.4);
  doc.moveTo(M, doc.y).lineTo(doc.page.width - M, doc.y).strokeColor(C.rule).lineWidth(0.7).stroke();
  doc.moveDown(0.4);
}
function iso(s: string): string {
  return `${s.slice(0, 16).replace('T', ' ')} UTC`;
}
function statusLine(ev: EvidencePackInput['event']): string {
  if (ev.status === 'open') return 'OPEN — the vessel has not been re-observed';
  if (ev.status === 'void') return `VOID — ${ev.void_reason ?? 'coverage lost'}`;
  return ev.resolution === 'reappeared'
    ? `RESOLVED — REAPPEARED at ${ev.closed_at ? iso(ev.closed_at) : '?'}`
    : `RESOLVED — NOT RE-OBSERVED within 72 h (closed ${ev.closed_at ? iso(ev.closed_at) : '?'})`;
}
function resolutionGloss(ev: EvidencePackInput['event']): string {
  if (ev.status === 'open') {
    return 'This event is OPEN: the vessel had not been re-observed by eYKON\'s AIS coverage when this document was generated. The silence figure will have changed since.';
  }
  if (ev.status === 'void') {
    return 'This event is VOID: the coverage box that measured the silence went dead while the event was open. Continued silence became unmeasurable, and the event resolves neither way — never a win, never a loss.';
  }
  return ev.resolution === 'reappeared'
    ? 'Resolved REAPPEARED: a newer AIS fix was received. Reappearance is a positive, feed-wide observation.'
    : 'Resolved NOT RE-OBSERVED: no fix reached eYKON\'s AIS coverage within 72 hours of the event opening. This is a statement about the instrument\'s view, never proof the transponder was off.';
}
