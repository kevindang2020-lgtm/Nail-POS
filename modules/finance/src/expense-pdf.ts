/**
 * expense-pdf.ts — the expense report as a PDF SUMMARY (Receipt/Expense mandate §98; Kevin, Nov 6 2026: "yes" — build it).
 *
 * A DOWNLOAD for the owner's accountant (Content-Disposition: attachment, the same private export path as CSV / XLSX). It
 * is not the POS printing a schedule or a ticket, and no print dialog is used (the no-print rule is about those).
 *
 * The SAME exact-cents rows as the CSV / XLSX (expense.service exportFile): nothing is recalculated here. The summary
 * carries the period, the bookkeeping disclaimer (§162), totals by category and by payment method, every expense line,
 * and a grand total equal to the report's total (tested). English, like the CSV / XLSX headers; the text is set in Work
 * Sans (SIL OFL 1.1, assets/fonts, licence beside it) so Vietnamese vendor names and descriptions render (the PDF
 * standard fonts cannot draw "ợ", "ầ", "ữ").
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { dollars, exportTotalCents, EXPORT_DISCLAIMER, type ExportRow } from './expense-export';

let fontCache: { regular: Buffer; bold: Buffer } | null = null;
/** src/ and dist/ both sit one level under the module */
function fonts(): { regular: Buffer; bold: Buffer } {
  if (!fontCache) {
    const dir = join(__dirname, '..', 'assets', 'fonts');
    fontCache = { regular: readFileSync(join(dir, 'WorkSans-Regular.ttf')), bold: readFileSync(join(dir, 'WorkSans-Bold.ttf')) };
  }
  return fontCache;
}

const INK = '#231C15', MUTED = '#6E6457', LINE = '#DDD3C4', ACCENT = '#9C7A45', BAND = '#F6F1E8';
const PAGE = { w: 612, h: 792, m: 42 };   // US Letter
/** $1,234.56 / -$5.00 — from dollars() (exact cents), with thousands separators */
const money = (c: number) => { const d = dollars(c); const neg = d.startsWith('-'); const [i, f] = (neg ? d.slice(1) : d).split('.'); return `${neg ? '-' : ''}$${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`; };

/** Totals grouped by a key, largest first; exact integer cents. Exported for the tests. */
export function groupTotals(rows: readonly ExportRow[], key: (r: ExportRow) => string): Array<{ label: string; count: number; totalCents: number }> {
  const m = new Map<string, { count: number; totalCents: number }>();
  for (const r of rows) { const k = key(r) || '—'; const g = m.get(k) ?? { count: 0, totalCents: 0 }; g.count++; g.totalCents += r.totalCents; m.set(k, g); }
  return [...m.entries()].map(([label, g]) => ({ label, ...g })).sort((a, b) => b.totalCents - a.totalCents || a.label.localeCompare(b.label));
}

export async function toExpensePdf(rows: readonly ExportRow[], meta: { title: string; period: string; generatedAt?: Date }): Promise<Uint8Array> {
  const f = fonts();
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: PAGE.m, bottom: PAGE.m, left: PAGE.m, right: PAGE.m }, bufferPages: true,
    info: { Title: `${meta.title} — ${meta.period}`, Creator: 'AI PowerSalon', Producer: 'AI PowerSalon' } });
  doc.registerFont('r', f.regular); doc.registerFont('b', f.bold);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((res) => doc.on('end', () => res(new Uint8Array(Buffer.concat(chunks)))));
  const W = PAGE.w - PAGE.m * 2;
  const bottom = PAGE.h - PAGE.m - 24;
  const total = exportTotalCents(rows);

  // ── header
  doc.font('b').fontSize(18).fillColor(INK).text(meta.title, PAGE.m, PAGE.m);
  doc.font('r').fontSize(10).fillColor(MUTED).text(`${meta.period} · ${rows.length} expense${rows.length === 1 ? '' : 's'}`);
  doc.moveDown(0.4);
  doc.font('r').fontSize(8).fillColor(MUTED).text(EXPORT_DISCLAIMER, { width: W });   // §162
  doc.moveDown(0.6);
  // total band
  const by = doc.y;
  doc.rect(PAGE.m, by, W, 34).fill(BAND);
  doc.font('r').fontSize(9).fillColor(MUTED).text('TOTAL EXPENSES', PAGE.m + 12, by + 7);
  doc.font('b').fontSize(16).fillColor(INK).text(money(total), PAGE.m + 12, by + 7, { width: W - 24, align: 'right' });
  doc.y = by + 46;

  // ── two summary tables side by side: by category, by payment method
  const half = (W - 16) / 2;
  const summary = (title: string, groups: ReturnType<typeof groupTotals>, x: number, y0: number) => {
    let y = y0;
    doc.font('b').fontSize(10).fillColor(ACCENT).text(title.toUpperCase(), x, y, { width: half }); y += 16;
    for (const g of groups) {
      doc.font('r').fontSize(9).fillColor(INK).text(`${g.label} (${g.count})`, x, y, { width: half - 80, ellipsis: true, lineBreak: false });
      doc.text(money(g.totalCents), x + half - 80, y, { width: 80, align: 'right' });
      y += 14;
      doc.moveTo(x, y - 2).lineTo(x + half, y - 2).lineWidth(0.5).strokeColor(LINE).stroke();
    }
    return y;
  };
  const sy = doc.y;
  const yA = summary('By category', groupTotals(rows, (r) => r.category), PAGE.m, sy);
  const yB = summary('By payment method', groupTotals(rows, (r) => r.paymentMethod), PAGE.m + half + 16, sy);
  doc.y = Math.max(yA, yB) + 14;

  // ── the lines
  const cols = [{ h: 'Date', w: 62 }, { h: 'Vendor', w: 120 }, { h: 'Category', w: 92 }, { h: 'Description', w: W - 62 - 120 - 92 - 54 - 66 }, { h: 'Status', w: 54 }, { h: 'Total', w: 66, right: true }];
  const head = () => {
    let x = PAGE.m; const y = doc.y;
    doc.font('b').fontSize(8).fillColor(MUTED);
    for (const c of cols) { doc.text(c.h.toUpperCase(), x, y, { width: c.w - 4, align: c.right ? 'right' : 'left', lineBreak: false }); x += c.w; }
    doc.moveTo(PAGE.m, y + 12).lineTo(PAGE.m + W, y + 12).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.y = y + 16;
  };
  doc.font('b').fontSize(10).fillColor(ACCENT).text('EXPENSES', PAGE.m, doc.y); doc.moveDown(0.3);
  head();
  for (const r of rows) {
    if (doc.y > bottom) { doc.addPage(); doc.y = PAGE.m; head(); }
    const y = doc.y; let x = PAGE.m;
    const cells = [r.date, r.vendor, r.category, r.description, r.status, money(r.totalCents)];
    doc.font('r').fontSize(8.5).fillColor(INK);
    cells.forEach((v, i) => { doc.text(v || '—', x, y, { width: cols[i].w - 4, align: cols[i].right ? 'right' : 'left', ellipsis: true, lineBreak: false }); x += cols[i].w; });
    doc.y = y + 13;
  }
  if (doc.y > bottom) { doc.addPage(); doc.y = PAGE.m; }
  doc.moveTo(PAGE.m, doc.y).lineTo(PAGE.m + W, doc.y).lineWidth(0.8).strokeColor(INK).stroke();
  doc.font('b').fontSize(10).fillColor(INK).text('TOTAL', PAGE.m, doc.y + 4).text(money(total), PAGE.m, doc.y - 12, { width: W, align: 'right' });

  // ── footer on every page
  const range = doc.bufferedPageRange();
  const stamp = (meta.generatedAt ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;   // the footer sits in the margin: without this pdfkit would start a new page for it
    doc.font('r').fontSize(7.5).fillColor(MUTED).text(`AI PowerSalon · generated ${stamp} UTC · page ${i + 1} of ${range.count}`, PAGE.m, PAGE.h - PAGE.m - 6, { width: W, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}
