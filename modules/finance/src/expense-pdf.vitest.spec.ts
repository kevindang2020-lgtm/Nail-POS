// expense-pdf.vitest.spec.ts — §98 (Nov 6 2026): the PDF summary is the SAME exact-cents rows as the CSV / XLSX — its grand
// total, category and method totals add up to the report's total, Vietnamese text renders, long reports page cleanly.
import { describe, it, expect } from 'vitest';
import { pdfText, pdfPageCount } from '@aipowersalon/testing/pdf-text';
import { toExpensePdf, groupTotals } from './expense-pdf';
import { ACCOUNTING_EXPORT_ADAPTERS, exportTotalCents, type ExportRow } from './expense-export';

const r = (i: number, over: Partial<ExportRow> = {}): ExportRow => ({ date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, vendor: i % 2 ? 'Sally Beauty' : 'Nhà cung cấp Đặng', category: i % 3 ? 'Supplies' : 'Rent',
  accountingCode: '', branch: 'Main', description: i % 2 ? 'Gel polish' : 'Dụng cụ làm móng', subtotalCents: null, taxCents: null, totalCents: 1000 + i * 7,
  paymentMethod: i % 4 ? 'card' : 'cash', receiptNumber: '', invoiceNumber: '', receiptAttached: false, status: 'approved', ...over });

describe('expense PDF summary (§98)', () => {
  it('group totals are exact and add up to the report total', () => {
    const rows = Array.from({ length: 13 }, (_, i) => r(i));
    const total = exportTotalCents(rows);
    for (const k of [(x: ExportRow) => x.category, (x: ExportRow) => x.paymentMethod]) {
      const g = groupTotals(rows, k);
      expect(g.reduce((s, x) => s + x.totalCents, 0)).toBe(total);
      expect(g.reduce((s, x) => s + x.count, 0)).toBe(rows.length);
    }
  });
  it('is a PDF with the period, the disclaimer, both summaries, the lines (Vietnamese intact) and the exact total', async () => {
    const rows = [r(1), r(2), r(3, { totalCents: -500, status: 'refund' })];
    const bytes = await toExpensePdf(rows, { title: 'Expenses', period: '2026-10-01 to 2026-10-31', generatedAt: new Date('2026-11-06T15:00:00Z') });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    const text = pdfText(Buffer.from(bytes));
    for (const s of ['Expenses', '2026-10-01 to 2026-10-31', 'not tax or accounting advice', 'BY CATEGORY', 'BY PAYMENT METHOD', 'Nhà cung cấp Đặng', 'Dụng cụ làm móng', 'Sally Beauty', '-$5.00']) expect(text).toContain(s);
    expect(text).toContain(`$${(exportTotalCents(rows) / 100).toFixed(2)}`);
  });
  it('a long report runs onto more pages with a footer on each; an empty one still renders', async () => {
    const many = Array.from({ length: 140 }, (_, i) => r(i));
    const bytes = Buffer.from(await toExpensePdf(many, { title: 'Expenses', period: 'p' }));
    const pages = pdfPageCount(bytes);
    expect(pages).toBeGreaterThan(2);
    expect(pdfText(bytes)).toContain(`page ${pages} of ${pages}`);
    const empty = Buffer.from(await ACCOUNTING_EXPORT_ADAPTERS.get('pdf')!.render([], { title: 'Expenses', period: 'p' }));
    expect(pdfPageCount(empty)).toBe(1);
    expect(pdfText(empty)).toContain('$0.00');
  });
});
