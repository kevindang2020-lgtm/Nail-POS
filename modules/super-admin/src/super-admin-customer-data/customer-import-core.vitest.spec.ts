import { describe, it, expect } from 'vitest';
import { stageRows, summarizeJob, canApprove, canRetry, dedupKeyFor, importSuccessRate, type RawImportRow } from './customer-import-core';

const rows: RawImportRow[] = [
  { rowNumber: 1, firstName: 'Emily', lastName: 'Johnson', phone: '+12125550101', email: 'emily@example.com' }, // valid
  { rowNumber: 2, firstName: 'Bad', lastName: 'Phone', phone: '123', email: null },                            // invalid phone
  { rowNumber: 3, firstName: '', lastName: '', phone: '+12125550102', email: null },                           // missing name
  { rowNumber: 4, firstName: 'No', lastName: 'Contact', phone: null, email: null },                            // no contact method
  { rowNumber: 5, firstName: 'Emily', lastName: 'J', phone: '+12125550101', email: null },                     // duplicate of row 1 (same phone)
];

describe('customer-import engine', () => {
  it('builds a tenant-scoped dedup key preferring phone, then email, then name', () => {
    expect(dedupKeyFor('t1', { rowNumber: 1, phone: '(212) 555-0101' })).toBe('t1|p|2125550101');
    expect(dedupKeyFor('t1', { rowNumber: 1, email: 'A@B.com' })).toBe('t1|e|a@b.com');
    expect(dedupKeyFor('t2', { rowNumber: 1, phone: '(212) 555-0101' })).not.toBe(dedupKeyFor('t1', { rowNumber: 1, phone: '(212) 555-0101' }));
  });

  it('classifies staged rows and flags in-file duplicates', () => {
    const staged = stageRows('t1', rows);
    expect(staged[0].status).toBe('valid');
    expect(staged[1]).toMatchObject({ status: 'invalid', error: 'Invalid phone number' });
    expect(staged[2]).toMatchObject({ status: 'invalid', error: 'Missing name' });
    expect(staged[3].status).toBe('invalid');
    expect(staged[4]).toMatchObject({ status: 'invalid', error: 'Duplicate of an earlier row in this file' });
  });

  it('summarizes counts', () => {
    const s = summarizeJob(stageRows('t1', rows));
    expect(s.totalRows).toBe(5);
    expect(s.validRows).toBe(1);
    expect(s.invalidRows).toBe(4);
  });

  it('gates approval: pending with valid rows ok; no valid rows blocked', () => {
    const s = summarizeJob(stageRows('t1', rows));
    expect(canApprove('pending', s).ok).toBe(true);
    expect(canApprove('approved', s).ok).toBe(false);
    expect(canApprove('pending', { totalRows: 2, validRows: 0, invalidRows: 2, importedRows: 0, failedRows: 0 }).ok).toBe(false);
  });

  it('retry re-runs only valid/failed rows, never already-imported ones (idempotency)', () => {
    const after = [
      { rowNumber: 1, status: 'imported' as const },
      { rowNumber: 2, status: 'failed' as const },
      { rowNumber: 3, status: 'invalid' as const },
      { rowNumber: 4, status: 'valid' as const },
    ];
    const r = canRetry('completed', after);
    expect(r.ok).toBe(true);
    expect(r.retryRowNumbers).toEqual([2, 4]); // not 1 (imported) and not 3 (invalid)
    expect(canRetry('pending', after).ok).toBe(false);
    expect(canRetry('completed', [{ rowNumber: 1, status: 'imported' }]).ok).toBe(false);
  });

  it('computes success rate over attempted rows only', () => {
    expect(importSuccessRate({ totalRows: 10, validRows: 0, invalidRows: 2, importedRows: 6, failedRows: 2 })).toBe(75);
    expect(importSuccessRate({ totalRows: 3, validRows: 3, invalidRows: 0, importedRows: 0, failedRows: 0 })).toBeNull();
  });
});
