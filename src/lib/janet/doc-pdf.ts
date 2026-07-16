// JANET The Doc (Feature 2) — real, designed PDF export. Built with pdfkit (not a
// print-view). On-brand: a navy cover band with the BLVSTACK wordmark + electric
// accent, serif body on warm paper, navy headings, electric bullets. A proposal
// that can be forwarded, printed, or filed and still looks like our work.

import PDFDocument from 'pdfkit';
import type { DocBlock } from './doc-blocks';

const NAVY = '#0A1628';
const CREAM = '#FAF8F3';
const ELECTRIC = '#2563EB';
const SLATE = '#5A6678';
const GOLD = '#B98A2E';
const PAPER = '#FCFBF8';
const INK = '#1A2230';

const M = 64; // page margin

export async function renderDocPdf(doc: { title: string; content: DocBlock[]; client_name?: string | null; doc_type?: string | null }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'LETTER', margins: { top: M, bottom: M, left: M, right: M }, bufferPages: true });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const W = pdf.page.width;
    const H = pdf.page.height;
    const contentW = W - M * 2;

    // Warm paper on page 1 (subtle — reads premium, prints clean).
    pdf.rect(0, 0, W, H).fill(PAPER);

    // ── Cover band ──
    pdf.rect(0, 0, W, 196).fill(NAVY);
    pdf.rect(0, 196, W, 3).fill(ELECTRIC);
    pdf.fillColor(CREAM).font('Helvetica-Bold').fontSize(11).text('BLVSTACK', M, 46, { characterSpacing: 3 });
    pdf.fillColor('#93B4F5').font('Helvetica-Bold').fontSize(8).text((doc.doc_type || 'proposal').toUpperCase(), M, 96, { characterSpacing: 2.5 });
    pdf.fillColor(CREAM).font('Helvetica-Bold').fontSize(25).text(doc.title, M, 112, { width: contentW, lineGap: 1 });

    // Meta line under the band.
    const meta = [doc.client_name ? `Prepared for ${doc.client_name}` : null, new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })]
      .filter(Boolean)
      .join('    ·    ');
    pdf.fillColor(SLATE).font('Helvetica').fontSize(10).text(meta, M, 216, { width: contentW });

    // ── Body ──
    pdf.y = 252;
    pdf.x = M;
    for (const b of doc.content ?? []) renderBlock(pdf, b, contentW);

    // ── Footer on every page ──
    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(range.start + i);
      const fy = H - 44;
      pdf.fillColor(SLATE).font('Helvetica').fontSize(8);
      pdf.text('BLVSTACK · blvstack.com', M, fy, { width: contentW / 2, align: 'left', lineBreak: false });
      pdf.text(`${i + 1} / ${range.count}`, M + contentW / 2, fy, { width: contentW / 2, align: 'right', lineBreak: false });
    }

    pdf.end();
  });
}

function renderBlock(pdf: PDFKit.PDFDocument, b: DocBlock, contentW: number) {
  pdf.x = M;
  switch (b.type) {
    case 'heading': {
      pdf.moveDown(b.level === 1 ? 1 : 0.6);
      if (b.level === 1) {
        // Section headings get a small gold rule for structure.
        pdf.fillColor(GOLD).font('Helvetica-Bold').fontSize(8).text('—', M, pdf.y, { continued: false });
      }
      const size = b.level === 1 ? 16 : b.level === 2 ? 12.5 : 11;
      pdf.fillColor(NAVY).font('Helvetica-Bold').fontSize(size).text(b.text, M, pdf.y, { width: contentW });
      pdf.moveDown(0.35);
      break;
    }
    case 'bullet': {
      const y = pdf.y;
      pdf.fillColor(ELECTRIC).font('Helvetica-Bold').fontSize(11).text('•', M, y, { width: 12, lineBreak: false });
      pdf.fillColor(INK).font('Times-Roman').fontSize(11).text(b.text, M + 16, y, { width: contentW - 16, lineGap: 1.5 });
      pdf.moveDown(0.15);
      break;
    }
    case 'checklist': {
      const y = pdf.y;
      pdf.fillColor(b.checked ? ELECTRIC : SLATE).font('Helvetica').fontSize(11).text(b.checked ? '☑' : '☐', M, y, { width: 14, lineBreak: false });
      pdf.fillColor(INK).font('Times-Roman').fontSize(11).text(b.text, M + 18, y, { width: contentW - 18, lineGap: 1.5 });
      pdf.moveDown(0.15);
      break;
    }
    case 'code': {
      pdf.moveDown(0.3);
      pdf.fillColor('#556072').font('Courier').fontSize(9.5).text(b.text, M, pdf.y, { width: contentW, lineGap: 1 });
      pdf.moveDown(0.3);
      break;
    }
    case 'field': {
      pdf.moveDown(0.2);
      pdf.fillColor(GOLD).font('Helvetica-Bold').fontSize(11).text(`${b.label}${b.required ? ' *' : ''}`, M, pdf.y, { width: contentW });
      if (b.options?.length) pdf.fillColor(SLATE).font('Helvetica').fontSize(9).text(b.options.map((o) => `☐ ${o}`).join('   '), M, pdf.y, { width: contentW });
      else pdf.fillColor(SLATE).font('Helvetica').fontSize(9).text('__________________________', M, pdf.y, { width: contentW });
      pdf.moveDown(0.5);
      break;
    }
    default: {
      const isAttribution = /^—\s*from JANET/i.test(b.text);
      if (!b.text.trim()) { pdf.moveDown(0.4); break; }
      if (isAttribution) {
        pdf.fillColor(SLATE).font('Times-Italic').fontSize(9).text(b.text, M, pdf.y, { width: contentW });
      } else {
        pdf.fillColor(INK).font('Times-Roman').fontSize(11).text(b.text, M, pdf.y, { width: contentW, lineGap: 2.5 });
      }
      pdf.moveDown(0.5);
    }
  }
}
