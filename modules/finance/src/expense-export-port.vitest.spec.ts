// expense-export-port.vitest.spec.ts — Receipt/Expense mandate §102: exports go through a named port; each format is an
// adapter returning the same exact-cents content the service used to build inline.
import { describe, it, expect } from 'vitest';
import { ACCOUNTING_EXPORT_ADAPTERS, csvExportAdapter, toExpenseCsv, type ExportRow } from './expense-export';

const row: ExportRow = { date: '2026-11-01', vendor: '=HYPERLINK("x")', category: 'Supplies', accountingCode: '6000', branch: 'Main', description: 'Gel', subtotalCents: 1000, taxCents: 66,
  totalCents: 1066, paymentMethod: 'cash', receiptNumber: 'R1', invoiceNumber: '', receiptAttached: true, status: 'approved' } as ExportRow;

describe('AccountingExportPort (§102)', () => {
  it('registers exactly the CSV, XLSX and PDF-summary adapters by key (PDF: §98, Kevin Nov 6 2026)', () => {
    expect([...ACCOUNTING_EXPORT_ADAPTERS.keys()].sort()).toEqual(['csv', 'pdf', 'xlsx']);
    expect(ACCOUNTING_EXPORT_ADAPTERS.get('pdf')!.contentType).toBe('application/pdf');
    expect(ACCOUNTING_EXPORT_ADAPTERS.get('docx')).toBeUndefined();
  });
  it('the CSV adapter renders the same bytes as the CSV writer (formula-safe, exact cents)', async () => {
    const bytes = await csvExportAdapter.render([row], { title: 'Expenses', period: 'p' });
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(toExpenseCsv([row]));
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain('10.66');
  });
  it('the XLSX adapter returns a workbook (zip) with its content type', async () => {
    const x = ACCOUNTING_EXPORT_ADAPTERS.get('xlsx')!;
    const bytes = await x.render([row], { title: 'Expenses', period: 'p' });
    expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);   // "PK"
    expect(x.contentType).toMatch(/spreadsheetml/);
  });
});
