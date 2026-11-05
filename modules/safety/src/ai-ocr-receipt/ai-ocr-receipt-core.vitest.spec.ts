// ai-ocr-receipt-core.vitest.spec.ts — the pure classification + financial-normalization core. Money is integer cents;
// dates and line reconciliation FLAG ambiguity rather than guessing (this feeds financial records a human must review);
// card/bank numbers are masked to the last 4; document text is parsed as untrusted data.
import { describe, it, expect } from 'vitest';
import { classifyDocument, parseMoney, normalizeDate, maskCardNumber, redactSensitive, reconcileLineItem } from './ai-ocr-receipt-core';

describe('document classification', () => {
  it('classifies supported types with alternatives', () => {
    expect(classifyDocument('INVOICE #4412 Bill To: Glow  Amount Due $500 Net 30').type).toBe('invoice');
    expect(classifyDocument('RECEIPT Subtotal 12.00 Change Due 3.00 Thank you for your purchase').type).toBe('receipt');
    expect(classifyDocument('Electric utility service period kWh usage account number 55').type).toBe('utility_bill');
    expect(classifyDocument('PURCHASE ORDER PO Number 88 Ship To warehouse order date').type).toBe('purchase_order');
    expect(classifyDocument('').type).toBe('unknown');
  });
});

describe('money parsing (integer cents)', () => {
  it('handles US and EU formats, refunds, and garbage', () => {
    expect(parseMoney('$1,234.56')?.cents).toBe(123456);
    expect(parseMoney('1.234,56')?.cents).toBe(123456);
    expect(parseMoney('12.50')?.cents).toBe(1250);
    expect(parseMoney('12,50')?.cents).toBe(1250);
    expect(parseMoney('1,234')?.cents).toBe(123400);
    expect(parseMoney('-$45.00')).toEqual({ cents: 4500, negative: true });
    expect(parseMoney('N/A')).toBeNull();
  });
});

describe('date normalization (flags ambiguity)', () => {
  it('flags ambiguous numeric dates and resolves by locale', () => {
    const amb = normalizeDate('03/04/2025');
    expect(amb.ambiguous).toBe(true);
    expect(amb.candidates).toHaveLength(2);
    expect(normalizeDate('03/04/2025', { localePrefersDMY: true }).iso).toBe('2025-04-03');
    expect(normalizeDate('03/04/2025').iso).toBe('2025-03-04');
  });
  it('recognizes unambiguous and invalid dates', () => {
    expect(normalizeDate('13/04/2025')).toMatchObject({ iso: '2025-04-13', ambiguous: false });
    expect(normalizeDate('2025-03-04')).toMatchObject({ iso: '2025-03-04', ambiguous: false });
    expect(normalizeDate('99/99/2025').iso).toBeNull();
  });
});

describe('PII masking + reconciliation', () => {
  it('masks card numbers and never emits a full PAN', () => {
    expect(maskCardNumber('4111 1111 1111 1234')).toBe('••••1234');
    const red = redactSensitive('paid with 4111111111111234 today');
    expect(red).not.toContain('4111111111111234');
    expect(red).toContain('••••1234');
  });
  it('flags line-item mismatches rather than silently fixing them', () => {
    expect(reconcileLineItem({ quantity: 2, unitPriceCents: 500, discountCents: 0, taxCents: 0, lineTotalCents: 1000 })).toBe(true);
    expect(reconcileLineItem({ quantity: 2, unitPriceCents: 500, discountCents: 0, taxCents: 0, lineTotalCents: 1500 })).toBe(false);
    expect(reconcileLineItem({ quantity: null, unitPriceCents: 500, discountCents: 0, taxCents: 0, lineTotalCents: 1000 })).toBeNull();
  });
});
