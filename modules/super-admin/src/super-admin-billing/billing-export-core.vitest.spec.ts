import { describe, it, expect } from 'vitest';
import { sanitizeCell, toCsv, assertSafeColumns, REPORTS, ExportColumnError } from './billing-export-core';

describe('sanitizeCell', () => {
  it('neutralizes formula-injection prefixes', () => {
    expect(sanitizeCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(sanitizeCell('+1')).toBe("'+1");
    expect(sanitizeCell('@cmd')).toBe("'@cmd");
    expect(sanitizeCell('normal')).toBe('normal');
  });
  it('quotes cells with commas/quotes/newlines', () => {
    expect(sanitizeCell('a,b')).toBe('"a,b"');
    expect(sanitizeCell('he said "hi"')).toBe('"he said ""hi"""');
  });
});

describe('assertSafeColumns', () => {
  it('rejects card/contact columns', () => {
    expect(() => assertSafeColumns([{ key: 'card_number', label: 'Card' }])).toThrow(ExportColumnError);
    expect(() => assertSafeColumns([{ key: 'email', label: 'Email' }])).toThrow(ExportColumnError);
    expect(() => assertSafeColumns([{ key: 'tenant', label: 'Tenant' }])).not.toThrow();
  });
});

describe('report registry', () => {
  it('every report has safe columns and builds a CSV', () => {
    for (const [, def] of Object.entries(REPORTS)) {
      expect(() => toCsv(def.columns, [])).not.toThrow();
    }
  });
  it('invoices report maps money and omits any card column', () => {
    const csv = toCsv(REPORTS.invoices.columns, [REPORTS.invoices.map({ invoiceNumber: 'INV-1', tenant: 'Pilot', amountCents: 19900, dueDate: '2026-05-01T00:00:00Z', status: 'past_due', retryStatus: 'Retry 2 of 3' })]);
    expect(csv).toContain('199.00');
    expect(csv).not.toMatch(/card|cvv|token/i);
  });
});
