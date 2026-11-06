// expense-export.ts — the accountant export (mandate §97–100, §202): the SAME rows as the report, as CSV or XLSX.
//
// Columns are §99's list. Money is written as dollars with two decimals (integer cents divided exactly — never float
// arithmetic on the sum). The file carries a total row that equals the report's total, which the tests check. It is the
// salon's sensitive business data: built only behind expenses export permission, delivered through the private async
// export store, never a public URL (§100). A cell that starts with = + - @ is prefixed so a spreadsheet never runs it.
import ExcelJS from 'exceljs';

export interface ExportRow {
  date: string; vendor: string; category: string; branch: string; description: string;
  subtotalCents: number | null; taxCents: number | null; totalCents: number;
  paymentMethod: string; receiptNumber: string; invoiceNumber: string; receiptAttached: boolean; status: string;
  accountingCode?: string;
}
export const EXPORT_HEADERS = ['Date', 'Vendor', 'Category', 'Accounting Code', 'Branch', 'Description', 'Subtotal', 'Tax', 'Total', 'Payment Method', 'Receipt Number', 'Invoice Number', 'Receipt Attached?', 'Status'] as const;

/** Receipt mandate §162 (Oct 28 2026): the export is bookkeeping, not tax advice. Shown in the XLSX (row 3) and by the
 *  export screens; the CSV stays purely tabular (header first, total last) because accounting imports read it as data. */
export const EXPORT_DISCLAIMER = 'For bookkeeping only — not tax or accounting advice. AI PowerSalon is not a CPA or tax preparer; review deductions with your accountant.';

export function dollars(cents: number | null | undefined): string {
  if (cents == null) return '';
  const neg = cents < 0; const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
/** CSV/formula-injection safe text (OWASP): a leading = + - @ tab or CR becomes literal. */
export function safeCell(v: string): string { return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; }
const csvQuote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function cells(r: ExportRow): string[] {
  return [r.date, safeCell(r.vendor), safeCell(r.category), safeCell(r.accountingCode ?? ''), safeCell(r.branch), safeCell(r.description), dollars(r.subtotalCents), dollars(r.taxCents), dollars(r.totalCents), r.paymentMethod, safeCell(r.receiptNumber), safeCell(r.invoiceNumber), r.receiptAttached ? 'Yes' : 'No', r.status];
}
export function exportTotalCents(rows: readonly ExportRow[]): number { return rows.reduce((s, r) => s + r.totalCents, 0); }

export function toExpenseCsv(rows: readonly ExportRow[]): string {
  const lines = [EXPORT_HEADERS.join(',')];
  for (const r of rows) lines.push(cells(r).map(csvQuote).join(','));
  lines.push(['', '', '', '', '', 'TOTAL', '', '', dollars(exportTotalCents(rows)), '', '', '', '', ''].map(csvQuote).join(','));
  return lines.join('\r\n') + '\r\n';
}

export async function toExpenseXlsx(rows: readonly ExportRow[], meta: { title: string; period: string }): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI PowerSalon';
  const ws = wb.addWorksheet('Expenses');
  ws.addRow([meta.title]); ws.addRow([meta.period]);
  const note = ws.addRow([EXPORT_DISCLAIMER]); note.font = { italic: true };   // §162
  const head = ws.addRow([...EXPORT_HEADERS]); head.font = { bold: true };
  for (const r of rows) {
    const c = cells(r);
    // money columns as numbers (cents / 100 is exact for display; the total row is computed from integer cents)
    const row = ws.addRow([c[0], c[1], c[2], c[3], c[4], c[5], r.subtotalCents == null ? null : r.subtotalCents / 100, r.taxCents == null ? null : r.taxCents / 100, r.totalCents / 100, c[9], c[10], c[11], c[12], c[13]]);
    for (const i of [7, 8, 9]) row.getCell(i).numFmt = '#,##0.00';
  }
  const total = ws.addRow(['', '', '', '', '', 'TOTAL', null, null, exportTotalCents(rows) / 100]);
  total.font = { bold: true }; total.getCell(9).numFmt = '#,##0.00';
  ws.columns.forEach((col, i) => { col.width = [12, 28, 22, 14, 18, 36, 12, 10, 12, 16, 16, 16, 10, 12][i] ?? 14; });
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** Receipt/Expense mandate §102 — the accounting export seam. An export format (today CSV and XLSX; a QuickBooks or Xero
 *  connector later) is an adapter of this port; the service picks one by key and never hard-wires a provider. Adapters
 *  receive finished, exact-cents rows and return bytes — they never read the database or see another salon's data. */
export interface AccountingExportPort {
  readonly key: string;
  readonly contentType: string;
  readonly extension: string;
  render(rows: readonly ExportRow[], meta: { title: string; period: string }): Promise<Uint8Array>;
}
export const csvExportAdapter: AccountingExportPort = {
  key: 'csv', contentType: 'text/csv; charset=utf-8', extension: 'csv',
  render: async (rows) => new TextEncoder().encode(toExpenseCsv(rows)),
};
export const xlsxExportAdapter: AccountingExportPort = {
  key: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx',
  render: (rows, meta) => toExpenseXlsx(rows, meta),
};
/** §98 PDF summary (Kevin, Nov 6 2026: build it) — totals by category / payment method + every line; expense-pdf.ts,
 *  loaded on first use (it imports this file's helpers, so a static import would be a cycle). */
export const pdfExportAdapter: AccountingExportPort = {
  key: 'pdf', contentType: 'application/pdf', extension: 'pdf',
  render: async (rows, meta) => (await import('./expense-pdf')).toExpensePdf(rows, meta),
};
/** the registered adapters; an unknown key is refused by the caller (no silent fallback to another format) */
export const ACCOUNTING_EXPORT_ADAPTERS: ReadonlyMap<string, AccountingExportPort> = new Map([csvExportAdapter, xlsxExportAdapter, pdfExportAdapter].map((a) => [a.key, a]));
