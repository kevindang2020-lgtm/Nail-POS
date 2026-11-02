// finance-pdf.ts — a small, dependency-free PDF writer for the Payments & Money documents (Oct 29 2026 mandates): the
// customer invoice (Invoices §14: print / download PDF) and the reconciliation reports (Deposit Reconciliation §16: CSV and
// PDF exports). Customer-facing invoices are ENGLISH ONLY (standing rule), so the PDF standard font Helvetica with
// WinAnsi encoding covers every character we print; anything outside it is replaced, never dropped silently.
//
// The document is a DOWNLOAD / inline file the browser's own PDF viewer shows — the POS never opens a print dialog
// (PRINT_FEATURES_REMOVED.md / check:no-print).
const W_REG: number[] = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD: number[] = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
/** WinAnsi codes for the few non-ASCII characters our documents use. */
const WIN: Record<string, { code: number; w: number }> = { '—': { code: 0x97, w: 1000 }, '–': { code: 0x96, w: 556 }, '•': { code: 0x95, w: 350 }, '·': { code: 0xb7, w: 278 }, '’': { code: 0x92, w: 222 }, '“': { code: 0x93, w: 333 }, '”': { code: 0x94, w: 333 }, '…': { code: 0x85, w: 1000 } };

export type Font = 'reg' | 'bold';
const charWidth = (ch: string, f: Font) => {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return (f === 'bold' ? W_BOLD : W_REG)[c - 32];
  return WIN[ch]?.w ?? 556;
};
export function textWidth(s: string, size: number, f: Font = 'reg'): number {
  let w = 0; for (const ch of s) w += charWidth(ch, f); return (w * size) / 1000;
}
/** Encode for a PDF literal string in WinAnsi: escape ( ) \, map the known non-ASCII, '?' for the rest. */
function encode(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c >= 32 && c <= 126) out += ch;
    else if (WIN[ch]) out += '\\' + WIN[ch].code.toString(8).padStart(3, '0');
    else if (c >= 160 && c <= 255) out += '\\' + c.toString(8).padStart(3, '0');   // Latin-1 = WinAnsi here (é, ñ, ü …)
    else if (ch === '\n' || ch === '\r' || ch === '\t') out += ' ';
    else out += '?';
  }
  return out;
}
/** Shorten to fit a width (ends in "…"); never wraps. */
export function fitText(s: string, width: number, size: number, f: Font = 'reg'): string {
  let t = String(s ?? '');
  if (textWidth(t, size, f) <= width) return t;
  while (t.length > 1 && textWidth(t + '…', size, f) > width) t = t.slice(0, -1);
  return t + '…';
}
/** Word-wrap into lines no wider than `width`. */
export function wrapText(s: string, width: number, size: number, f: Font = 'reg'): string[] {
  const lines: string[] = [];
  for (const para of String(s ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, f) <= width) line = next;
      else { if (line) lines.push(line); line = textWidth(word, size, f) > width ? fitText(word, width, size, f) : word; }
    }
    lines.push(line);
  }
  return lines;
}

export const PAGE = { w: 612, h: 792, m: 48 };   // US Letter
const rgb = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); return `${(((n >> 16) & 255) / 255).toFixed(3)} ${(((n >> 8) & 255) / 255).toFixed(3)} ${((n & 255) / 255).toFixed(3)}`; };

/** A page-at-a-time writer. y grows DOWN from the top edge (converted to PDF space on output). */
export class PdfWriter {
  private pages: string[][] = [];
  private cur: string[] = [];
  constructor(private readonly info: { title: string; author?: string }) { this.addPage(); }
  get pageCount() { return this.pages.length; }
  addPage() { this.cur = []; this.pages.push(this.cur); }
  text(s: string, x: number, y: number, o: { size?: number; font?: Font; color?: string; align?: 'left' | 'right' | 'center'; width?: number } = {}) {
    const size = o.size ?? 10, f = o.font ?? 'reg';
    let str = String(s ?? '');
    if (o.width) str = fitText(str, o.width, size, f);
    let px = x;
    if (o.align === 'right' && o.width) px = x + o.width - textWidth(str, size, f);
    else if (o.align === 'center' && o.width) px = x + (o.width - textWidth(str, size, f)) / 2;
    const py = PAGE.h - y - size;   // y is the TOP of the text line
    this.cur.push(`BT /${f === 'bold' ? 'F2' : 'F1'} ${size} Tf ${rgb(o.color ?? '#231C15')} rg ${px.toFixed(2)} ${py.toFixed(2)} Td (${encode(str)}) Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, o: { color?: string; width?: number } = {}) {
    this.cur.push(`${rgb(o.color ?? '#DDD3C4')} RG ${(o.width ?? 0.75).toFixed(2)} w ${x1.toFixed(2)} ${(PAGE.h - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE.h - y2).toFixed(2)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.cur.push(`${rgb(fill)} rg ${x.toFixed(2)} ${(PAGE.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  /** Serialize: catalog, pages, two standard fonts, one content stream per page, info, xref. */
  toBuffer(): Buffer {
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };
    const catalog = add(''); const pagesObj = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids: number[] = [];
    for (const p of this.pages) {
      const body = p.join('\n');
      const content = add(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${encode(this.info.title)}) /Author (${encode(this.info.author ?? 'AIPowerSalon')}) /Producer (AIPowerSalon) >>`);
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

export const money = (cents: number): string => {
  const neg = cents < 0, a = Math.abs(Math.round(cents));
  return `${neg ? '-' : ''}$${Math.floor(a / 100).toLocaleString('en-US')}.${String(a % 100).padStart(2, '0')}`;
};
/** 'YYYY-MM-DD' → 'Oct 29, 2026' (timezone-free); anything else → 'Not set'. */
export const longDate = (ymdStr: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymdStr ?? ''));
  if (!m) return 'Not set';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
};

/** A tabular report (Deposit Reconciliation Reports tab): title, scope lines, a paged table, totals, generated stamp. */
export function renderReportPdf(r: { title: string; scope: Array<[string, string]>; columns: Array<{ label: string; money?: boolean; align?: 'right' }>; rows: string[][]; totals: Array<[string, string]>; definition: string; salonName?: string }): Buffer {
  const pdf = new PdfWriter({ title: r.title, author: r.salonName });
  const L = PAGE.m, R = PAGE.w - PAGE.m, W = R - L, bottom = PAGE.h - PAGE.m - 24;
  let y = PAGE.m;
  const head = () => {
    pdf.text(r.salonName ?? 'AIPowerSalon', L, y, { size: 9, color: '#6E6457', width: W / 2 });
    pdf.text(r.title, L, y + 12, { size: 15, font: 'bold', width: W });
    y += 34;
  };
  head();
  for (const [k, v] of r.scope) { pdf.text(`${k}: ${v}`, L, y, { size: 8.5, color: '#6E6457', width: W }); y += 11; }
  for (const line of wrapText(r.definition, W, 8.5)) { pdf.text(line, L, y, { size: 8.5, color: '#6E6457' }); y += 11; }
  y += 6;
  const n = r.columns.length; const cw = W / n;
  const header = () => {
    pdf.rect(L, y, W, 16, '#F6F1E8');
    r.columns.forEach((c, i) => pdf.text(c.label, L + i * cw + 4, y + 4, { size: 8, font: 'bold', color: '#6E6457', width: cw - 8, align: c.money || c.align === 'right' ? 'right' : 'left' }));
    y += 20;
  };
  header();
  if (!r.rows.length) { pdf.text('No records for this scope.', L + 4, y, { size: 9, color: '#6E6457' }); y += 14; }
  for (const row of r.rows) {
    if (y + 14 > bottom) { pdf.addPage(); y = PAGE.m; head(); header(); }
    row.forEach((cell, i) => pdf.text(cell, L + i * cw + 4, y, { size: 8.5, width: cw - 8, align: r.columns[i]?.money || r.columns[i]?.align === 'right' ? 'right' : 'left' }));
    y += 13;
    pdf.line(L, y - 2, R, y - 2, { width: 0.4 });
  }
  y += 8;
  if (y + 14 * r.totals.length > bottom) { pdf.addPage(); y = PAGE.m; }
  for (const [k, v] of r.totals) { pdf.text(k, L, y, { size: 9, font: 'bold', width: W * 0.6 }); pdf.text(v, L + W * 0.6, y, { size: 9, font: 'bold', width: W * 0.4, align: 'right' }); y += 13; }
  return pdf.toBuffer();
}
