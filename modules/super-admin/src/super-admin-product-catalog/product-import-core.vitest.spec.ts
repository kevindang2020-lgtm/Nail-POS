import { describe, it, expect } from 'vitest';
import { validateImportRow, classifyRows, preImportStatus, summarizeImportResult, isRetryable, importSuccessRate, type ImportRowInput } from './product-import-core';

describe('product-import engine', () => {
  it('validates a staged row and returns the first blocking error', () => {
    expect(validateImportRow({ name: '', categoryName: 'Nail Care' })).toBe('missing_required_field');
    expect(validateImportRow({ name: 'X', categoryName: '' })).toBe('missing_category');
    expect(validateImportRow({ name: 'X', categoryName: 'Nail Care', sku: 'bad sku' })).toBe('invalid_sku_format');
    expect(validateImportRow({ name: 'X', categoryName: 'Nail Care', upc: '036000291453' })).toBe('invalid_upc');
    expect(validateImportRow({ name: 'X', categoryName: 'Nail Care', priceCents: -1 })).toBe('invalid_price');
    expect(validateImportRow({ name: 'X', categoryName: 'Nail Care', barcode: '' }, { requireBarcode: true })).toBe('missing_barcode');
    expect(validateImportRow({ name: 'Cuticle Oil', categoryName: 'Nail Care', sku: 'CND-CO-15', upc: '036000291452', priceCents: 899 })).toBeNull();
  });

  it('classifies a mixed batch', () => {
    const rows: ImportRowInput[] = [
      { name: 'Good', categoryName: 'Nail Care', sku: 'A-1', priceCents: 100 },
      { name: '', categoryName: 'Nail Care' },              // missing name
      { name: 'BadPrice', categoryName: 'Tools', priceCents: -5 },
    ];
    const c = classifyRows(rows);
    expect(c.total).toBe(3); expect(c.valid).toBe(1); expect(c.invalid).toBe(2);
    expect(c.errors.map((e) => e.errorType)).toEqual(['missing_required_field', 'invalid_price']);
    expect(preImportStatus(c)).toBe('ready'); // some valid rows
  });

  it('marks a fully-invalid batch as failed', () => {
    const c = classifyRows([{ name: '', categoryName: '' }]);
    expect(c.valid).toBe(0); expect(preImportStatus(c)).toBe('failed');
  });

  it('limits retry to technically retryable failures', () => {
    expect(isRetryable('invalid_price')).toBe(true);
    expect(isRetryable('missing_category')).toBe(true);
    expect(isRetryable('duplicate_sku')).toBe(false);
    expect(isRetryable('file_security_failure')).toBe(false);
    expect(isRetryable('cross_tenant_reference')).toBe(false);
  });

  it('summarizes import result and success rate', () => {
    expect(summarizeImportResult(10, 0)).toBe('imported');
    expect(summarizeImportResult(8, 2)).toBe('partially_imported');
    expect(summarizeImportResult(0, 5)).toBe('failed');
    expect(importSuccessRate([{ status: 'imported', importedRows: 90, failedRows: 10 }])).toBe(90);
    expect(importSuccessRate([])).toBeNull();
  });
});
