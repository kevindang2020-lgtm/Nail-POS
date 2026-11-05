import { describe, it, expect } from 'vitest';
import { normalizeSku, normalizeName, isValidUpc, validateMasterProductInput, duplicateCandidates, type ExistingMaster } from './product-master-core';

describe('product-master engine', () => {
  it('normalizes SKUs and names', () => {
    expect(normalizeSku('  cnd co 15 ')).toBe('CNDCO15');
    expect(normalizeSku('')).toBeNull();
    expect(normalizeName('  Gel   Polish  ')).toBe('gel polish');
  });

  it('validates UPC-A and EAN-13 check digits', () => {
    expect(isValidUpc('036000291452')).toBe(true);   // classic valid UPC-A
    expect(isValidUpc('036000291453')).toBe(false);  // wrong check digit
    expect(isValidUpc('4006381333931')).toBe(true);  // valid EAN-13
    expect(isValidUpc('12345')).toBe(false);          // wrong length
    expect(isValidUpc('abcdefghijkl')).toBe(false);   // non-numeric
  });

  it('requires name + category and validates SKU/price', () => {
    const bad = validateMasterProductInput({ name: '', categoryName: '', sku: 'has space', costCents: -5, suggestedRetailCents: 1.5 as any });
    expect(bad.errors).toContain('Product name is required.');
    expect(bad.errors).toContain('Category is required.');
    expect(bad.errors.some((e) => e.includes('SKU must be'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('Cost must be'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('Suggested retail'))).toBe(true);
  });

  it('accepts a well-formed product', () => {
    const ok = validateMasterProductInput({ name: 'Cuticle Oil', categoryName: 'Nail Care', sku: 'CND-CO-15', upc: '036000291452', costCents: 320, suggestedRetailCents: 899 });
    expect(ok.errors).toHaveLength(0);
    expect(ok.normalized.normalizedSku).toBe('CND-CO-15');
    expect(ok.normalized.normalizedName).toBe('cuticle oil');
  });

  it('detects duplicate candidates by SKU, barcode, and brand+name', () => {
    const existing: ExistingMaster[] = [
      { id: 'm1', name: 'Cuticle Oil', normalizedSku: 'CND-CO-15', barcode: '0631234567890', brandName: 'CND', normalizedName: 'cuticle oil' },
      { id: 'm2', name: 'Base Coat', normalizedSku: 'CND-BC', barcode: '0631234567893', brandName: 'CND', normalizedName: 'base coat' },
    ];
    const bySku = duplicateCandidates({ name: 'New', categoryName: 'X', sku: 'cnd-co-15' }, existing);
    expect(bySku[0]).toMatchObject({ id: 'm1', reason: 'exact_sku', confidence: 1 });

    const byBarcode = duplicateCandidates({ name: 'Whatever', barcode: '0631234567893' }, existing);
    expect(byBarcode.some((c) => c.id === 'm2' && c.reason === 'exact_barcode')).toBe(true);

    const byName = duplicateCandidates({ name: 'Cuticle  Oil', brandName: 'cnd' }, existing);
    expect(byName.some((c) => c.id === 'm1' && c.reason === 'brand_and_name')).toBe(true);

    expect(duplicateCandidates({ name: 'Totally New', brandName: 'Zzz', sku: 'ZZZ-1' }, existing)).toHaveLength(0);
  });
});
