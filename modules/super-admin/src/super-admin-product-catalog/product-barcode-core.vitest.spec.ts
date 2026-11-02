import { describe, it, expect } from 'vitest';
import { normalizeBarcode, classifyBarcodeType, validateBarcodeChange } from './product-barcode-core';

describe('product-barcode engine', () => {
  it('normalizes and classifies barcode types', () => {
    expect(normalizeBarcode('  036000 291452 ')).toBe('036000291452');
    expect(classifyBarcodeType('036000291452')).toBe('upc_a');
    expect(classifyBarcodeType('4006381333931')).toBe('ean_13');
    expect(classifyBarcodeType('ABC-123')).toBe('other');
    expect(classifyBarcodeType('')).toBe('unknown');
  });

  it('validates UPC/EAN checksum and requires a reason', () => {
    const bad = validateBarcodeChange({ barcode: '036000291453', reason: '' });
    expect(bad.errors).toContain('Barcode check digit is invalid.');
    expect(bad.errors).toContain('A reason is required for barcode changes.');

    const ok = validateBarcodeChange({ barcode: '036000291452', reason: 'vendor correction' });
    expect(ok.errors).toHaveLength(0);
    expect(ok.type).toBe('upc_a');
  });

  it('requires a value and (optionally) a checksum-bearing format', () => {
    expect(validateBarcodeChange({ barcode: '', reason: 'x' }).errors).toContain('A barcode value is required.');
    expect(validateBarcodeChange({ barcode: 'ABC-1', reason: 'x', requireChecksum: true }).errors.some((e) => e.includes('UPC-A or 13-digit EAN-13'))).toBe(true);
    expect(validateBarcodeChange({ barcode: 'ABC-1', reason: 'x' }).errors).toHaveLength(0); // non-checksum type allowed when not required
  });
});
