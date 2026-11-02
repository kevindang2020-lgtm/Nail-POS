import { describe, it, expect } from 'vitest';
import { toCsv, sanitizeCell, disputeToExportRecord, selectColumns, CSV_COLUMNS } from './export-core';

describe('sanitizeCell', () => {
  it('neutralizes formula/command injection', () => {
    expect(sanitizeCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeCell('+1+1')).toBe("'+1+1");
    expect(sanitizeCell('-2')).toBe("'-2");
    expect(sanitizeCell('@cmd')).toBe("'@cmd");
  });
  it('CSV-quotes commas, quotes, and newlines', () => {
    expect(sanitizeCell('a,b')).toBe('"a,b"');
    expect(sanitizeCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(sanitizeCell('line1\nline2')).toBe('"line1\nline2"');
  });
  it('passes through safe text', () => {
    expect(sanitizeCell('CHB-2026-000924')).toBe('CHB-2026-000924');
    expect(sanitizeCell(1245)).toBe('1245');
    expect(sanitizeCell(null)).toBe('');
  });
});

describe('toCsv', () => {
  it('builds a header + rows with CRLF', () => {
    const csv = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: '1', b: '2' }, { a: 'x', b: 'y' }]);
    expect(csv).toBe('A,B\r\n1,2\r\nx,y');
  });
  it('refuses forbidden columns (card/cvv/token/etc.)', () => {
    expect(() => toCsv([{ key: 'cardNumber', label: 'Card' }], [])).toThrow(/disallowed column/);
    expect(() => toCsv([{ key: 'x', label: 'CVV' }], [])).toThrow(/disallowed column/);
  });
});

describe('disputeToExportRecord', () => {
  const row = {
    disputeReference: 'CHB-2026-000924', amountCents: 124500, currency: 'USD', reasonCode: '10.4', reason: 'Fraud — Card Absent',
    tenantName: 'Pilot Nail Salon', branchName: 'Main', transactionRef: 'txn_7f94a1e2', dueBy: '2026-05-08T00:00:00Z', status: 'open',
    evidenceStatus: 'not_requested', processorDecision: 'none', fundsWithdrawnCents: 124500, fundsRecoveredCents: 0, riskLevel: 'high',
  };
  it('formats money as dollars and deadline as a date; never emits card/cvv fields', () => {
    const rec = disputeToExportRecord(row);
    expect(rec.amount).toBe('1245.00');
    expect(rec.fundsWithdrawn).toBe('1245.00');
    expect(rec.responseDeadline).toBe('2026-05-08');
    expect(Object.keys(rec).join(',')).not.toMatch(/card|cvv|token|pan/i);
  });
  it('round-trips through the CSV with the default columns', () => {
    const csv = toCsv(selectColumns(), [disputeToExportRecord(row)]);
    expect(csv.split('\r\n')[0]).toContain('Dispute ID');
    expect(csv).toContain('CHB-2026-000924');
    expect(csv).not.toMatch(/\b\d{16}\b/); // no 16-digit PAN anywhere
  });
});

describe('selectColumns', () => {
  it('defaults to all safe columns and filters unknowns', () => {
    expect(selectColumns()).toEqual(CSV_COLUMNS);
    expect(selectColumns(['disputeReference', 'amount', 'notacolumn']).map((c) => c.key)).toEqual(['disputeReference', 'amount']);
  });
});
