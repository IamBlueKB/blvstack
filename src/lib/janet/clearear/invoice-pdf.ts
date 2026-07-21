// Clear Ear Studios - the invoice document. A genuinely professional, MONOCHROME
// invoice built with pdfkit: generous whitespace, a strong typographic hierarchy,
// hairline rules, no color clutter. It goes to an organization's finance person,
// so it has to read like a real business's invoice - not a print-view of a table.
//
// The web view (/invoice/[token]) mirrors this exact layout so the on-screen and
// PDF versions match.

import PDFDocument from 'pdfkit';
import { CLEAREAR_LOGO_PNG, CLEAREAR_LOGO_RATIO } from './logo';

const INK = '#161616'; // near-black headings/emphasis
const BODY = '#2E2E2E'; // body text
const MUTE = '#8A8A8A'; // labels, secondary
const HAIR = '#DCDCDC'; // hairline rules
const FAINT = '#F4F4F4'; // zebra / panel fill

const M = 56; // page margin

export type InvoicePdfData = {
  invoice: any;
  lines: any[];
  payments: any[];
  contact: any;
  settings: any;
  methods: { label: string; instructions: string | null }[]; // the SELECTED methods, in order
};

const usd = (n: unknown) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const longDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const { invoice, lines, payments, contact, settings, methods } = data;
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'LETTER', margins: { top: M, bottom: M, left: M, right: M }, bufferPages: true });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const W = pdf.page.width;
    const H = pdf.page.height;
    const right = W - M;
    const contentW = W - M * 2;
    const businessName = settings?.business_name || 'Clear Ear Studios';

    // ── Masthead: logo left, INVOICE meta right ──────────────────────────────
    const logoH = 46;
    pdf.image(CLEAREAR_LOGO_PNG, M, M - 2, { height: logoH }); // width ~ logoH * ratio
    void CLEAREAR_LOGO_RATIO;

    pdf.fillColor(MUTE).font('Helvetica').fontSize(20).text('INVOICE', M, M - 2, { width: contentW, align: 'right', characterSpacing: 3 });
    const metaTop = M + 30;
    labelValueRight(pdf, 'NO.', invoice.invoice_number, right, metaTop);
    labelValueRight(pdf, 'ISSUED', longDate(invoice.issue_date), right, metaTop + 28);
    if (invoice.due_date) labelValueRight(pdf, 'DUE', longDate(invoice.due_date), right, metaTop + 56);

    // Rule under the masthead.
    let y = M + 96;
    rule(pdf, M, y, right);
    y += 22;

    // ── Bill To (left) / From (right) ────────────────────────────────────────
    const colW = (contentW - 40) / 2;
    const billX = M;
    const fromX = M + colW + 40;
    pdf.fillColor(MUTE).font('Helvetica-Bold').fontSize(8).text('BILL TO', billX, y, { characterSpacing: 1.5 });
    pdf.fillColor(MUTE).font('Helvetica-Bold').fontSize(8).text('FROM', fromX, y, { characterSpacing: 1.5 });
    let by = y + 14;
    pdf.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(contact?.name ?? '', billX, by, { width: colW });
    by = pdf.y + 1;
    if (contact?.contact_person) { pdf.fillColor(BODY).font('Helvetica').fontSize(10).text(`Attn: ${contact.contact_person}`, billX, by, { width: colW }); by = pdf.y; }
    addressLines(contact?.address).forEach((l) => { pdf.fillColor(BODY).font('Helvetica').fontSize(10).text(l, billX, by, { width: colW }); by = pdf.y; });
    if (contact?.email) { pdf.fillColor(MUTE).font('Helvetica').fontSize(9.5).text(contact.email, billX, by, { width: colW }); by = pdf.y; }

    let fy = y + 14;
    pdf.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(businessName, fromX, fy, { width: colW });
    fy = pdf.y + 1;
    addressLines(settings?.address).forEach((l) => { pdf.fillColor(BODY).font('Helvetica').fontSize(10).text(l, fromX, fy, { width: colW }); fy = pdf.y; });
    for (const line of [settings?.email, settings?.phone].filter(Boolean)) { pdf.fillColor(MUTE).font('Helvetica').fontSize(9.5).text(line, fromX, fy, { width: colW }); fy = pdf.y; }

    y = Math.max(by, fy) + 26;

    // ── Line items table ─────────────────────────────────────────────────────
    const cols = { desc: M, qty: right - 210, rate: right - 140, amount: right };
    pdf.fillColor(MUTE).font('Helvetica-Bold').fontSize(8);
    pdf.text('DESCRIPTION', cols.desc, y, { characterSpacing: 1, lineBreak: false });
    pdf.text('QTY', cols.qty - 30, y, { width: 40, align: 'right', characterSpacing: 1, lineBreak: false });
    pdf.text('RATE', cols.rate - 20, y, { width: 60, align: 'right', characterSpacing: 1, lineBreak: false });
    pdf.text('AMOUNT', cols.amount - 80, y, { width: 80, align: 'right', characterSpacing: 1, lineBreak: false });
    y += 14;
    rule(pdf, M, y, right);
    y += 10;

    for (const l of lines) {
      if (y > H - 200) { pdf.addPage(); y = M; }
      const startY = y;
      pdf.fillColor(INK).font('Helvetica').fontSize(10.5).text(l.description, cols.desc, y, { width: cols.qty - cols.desc - 40 });
      let descBottom = pdf.y;
      if (l.service_label) { pdf.fillColor(MUTE).font('Helvetica').fontSize(9).text(l.service_label, cols.desc, descBottom + 1, { width: cols.qty - cols.desc - 40 }); descBottom = pdf.y; }
      pdf.fillColor(BODY).font('Helvetica').fontSize(10.5);
      pdf.text(trimNum(l.quantity), cols.qty - 30, startY, { width: 40, align: 'right', lineBreak: false });
      pdf.text(usd(l.unit_price), cols.rate - 20, startY, { width: 60, align: 'right', lineBreak: false });
      pdf.fillColor(INK).text(usd(l.amount), cols.amount - 80, startY, { width: 80, align: 'right', lineBreak: false });
      y = Math.max(descBottom, startY + 14) + 8;
      pdf.strokeColor(FAINT).lineWidth(1).moveTo(M, y - 4).lineTo(right, y - 4).stroke();
    }

    // ── Totals ───────────────────────────────────────────────────────────────
    y += 8;
    const totalsX = right - 240;
    const totalsLabelW = 150;
    totalRow(pdf, 'Subtotal', usd(invoice.subtotal), totalsX, y, totalsLabelW); y += 18;
    if (Number(invoice.tax_amount) > 0 || Number(invoice.tax_rate) > 0) { totalRow(pdf, `Tax (${trimNum(invoice.tax_rate)}%)`, usd(invoice.tax_amount), totalsX, y, totalsLabelW); y += 18; }
    rule(pdf, totalsX, y + 2, right); y += 10;
    totalRow(pdf, 'Total', usd(invoice.total), totalsX, y, totalsLabelW, true); y += 22;
    if (Number(invoice.amount_paid) > 0) {
      totalRow(pdf, 'Paid', '-' + usd(invoice.amount_paid), totalsX, y, totalsLabelW); y += 18;
      // Balance Due panel.
      pdf.rect(totalsX - 12, y - 4, right - totalsX + 12, 30).fill(FAINT);
      totalRow(pdf, 'Balance Due', usd(invoice.balance), totalsX, y + 4, totalsLabelW, true); y += 34;
    }

    y += 18;

    // ── Payment instructions (only the selected methods) ─────────────────────
    const withInstr = (methods ?? []).filter((m) => m.instructions);
    if (withInstr.length) {
      if (y > H - 160) { pdf.addPage(); y = M; }
      pdf.fillColor(MUTE).font('Helvetica-Bold').fontSize(8).text('PAYMENT', M, y, { characterSpacing: 1.5 }); y += 14;
      for (const m of withInstr) {
        pdf.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(m.label, M, y, { width: 120, lineBreak: false });
        pdf.fillColor(BODY).font('Helvetica').fontSize(10).text(m.instructions || '', M + 120, y, { width: contentW - 120 });
        y = pdf.y + 8;
      }
    }

    // ── Notes / terms ────────────────────────────────────────────────────────
    const notes = invoice.notes || settings?.default_terms || settings?.default_notes;
    if (notes) {
      if (y > H - 120) { pdf.addPage(); y = M; }
      y += 6;
      pdf.fillColor(MUTE).font('Helvetica-Bold').fontSize(8).text('NOTES', M, y, { characterSpacing: 1.5 }); y += 12;
      pdf.fillColor(BODY).font('Helvetica').fontSize(9.5).text(notes, M, y, { width: contentW, lineGap: 2 });
    }

    // ── Footer on every page ─────────────────────────────────────────────────
    const range = pdf.bufferedPageRange();
    const footer = [businessName, addressOneLine(settings?.address), settings?.tax_id ? `EIN ${settings.tax_id}` : null].filter(Boolean).join('   ·   ');
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(range.start + i);
      const fyy = H - 40;
      pdf.strokeColor(HAIR).lineWidth(1).moveTo(M, fyy - 8).lineTo(right, fyy - 8).stroke();
      pdf.fillColor(MUTE).font('Helvetica').fontSize(8);
      pdf.text(footer, M, fyy, { width: contentW * 0.8, align: 'left', lineBreak: false });
      pdf.text(`${i + 1} / ${range.count}`, right - 60, fyy, { width: 60, align: 'right', lineBreak: false });
    }

    pdf.end();
  });
}

function rule(pdf: PDFKit.PDFDocument, x1: number, yy: number, x2: number) {
  pdf.strokeColor(HAIR).lineWidth(1).moveTo(x1, yy).lineTo(x2, yy).stroke();
}
function labelValueRight(pdf: PDFKit.PDFDocument, label: string, value: string, rightX: number, yy: number) {
  pdf.fillColor(MUTE).font('Helvetica-Bold').fontSize(7.5).text(label, rightX - 200, yy, { width: 200, align: 'right', characterSpacing: 1.2, lineBreak: false });
  pdf.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(value, rightX - 200, yy + 10, { width: 200, align: 'right', lineBreak: false });
}
function totalRow(pdf: PDFKit.PDFDocument, label: string, value: string, x: number, yy: number, labelW: number, strong = false) {
  pdf.fillColor(strong ? INK : MUTE).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 12 : 10).text(label, x, yy, { width: labelW, lineBreak: false });
  pdf.fillColor(INK).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 12 : 10).text(value, x + labelW, yy, { width: 90, align: 'right', lineBreak: false });
}
function trimNum(n: unknown): string {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(v);
}
function addressLines(addr: any): string[] {
  if (!addr || typeof addr !== 'object') return [];
  const l1 = [addr.line1].filter(Boolean).join('');
  const l2 = [addr.line2].filter(Boolean).join('');
  const l3 = [addr.city, addr.state].filter(Boolean).join(', ') + (addr.zip ? ` ${addr.zip}` : '');
  return [l1, l2, l3.trim()].filter((s) => s && s.trim());
}
function addressOneLine(addr: any): string {
  return addressLines(addr).join(', ');
}
